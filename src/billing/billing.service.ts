import { BadRequestException, Injectable } from '@nestjs/common';
import { PlanStatus, PlanType, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PLAN_LIMITS, PlanName } from '../config/plans';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../plan/plan.service';

const paidPlans: PlanType[] = [PlanType.Individual, PlanType.Organisation, PlanType.OrganisationPlus];
const planRank: Record<PlanType, number> = {
  [PlanType.Free]: 0,
  [PlanType.Individual]: 1,
  [PlanType.Organisation]: 2,
  [PlanType.OrganisationPlus]: 3,
};

@Injectable()
export class BillingService {
  private stripe?: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly planService: PlanService,
  ) {}

  async createCheckoutSession(userId: string, planType: PlanType) {
    if (!paidPlans.includes(planType)) {
      throw new BadRequestException('Choose a paid plan to start checkout.');
    }

    const stripe = this.getStripe();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const plan = await this.planService.getUserPlan(userId);
    const priceId = this.getPriceId(planType);
    const metadata = this.planMetadata(plan.metadata);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: metadata.stripeCustomerId as string | undefined,
      customer_email: metadata.stripeCustomerId ? undefined : user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${this.clientUrl()}/settings?billing=success`,
      cancel_url: `${this.clientUrl()}/settings?billing=cancelled`,
      client_reference_id: userId,
      metadata: { userId, planType },
      subscription_data: {
        metadata: { userId, planType },
      },
      allow_promotion_codes: true,
    });

    return { status: 'checkout', url: session.url };
  }

  async changePlan(userId: string, planType: PlanType) {
    if (!paidPlans.includes(planType)) {
      throw new BadRequestException('Choose a paid plan.');
    }

    const plan = await this.planService.getUserPlan(userId);
    const metadata = this.planMetadata(plan.metadata);
    const subscriptionId = metadata.stripeSubscriptionId as string | undefined;

    if (!subscriptionId || plan.status === 'cancelled' || plan.type === PlanType.Free) {
      return this.createCheckoutSession(userId, planType);
    }

    if (plan.type === planType) {
      return { status: 'unchanged' };
    }

    const stripe = this.getStripe();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const subscriptionAny = subscription as any;
    const currentItem = subscription.items.data[0];
    if (!currentItem) {
      throw new BadRequestException('Stripe subscription has no billable item.');
    }

    const priceId = this.getPriceId(planType);
    if (planRank[planType] > planRank[plan.type]) {
      const updated = await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: false,
        items: [{ id: currentItem.id, price: priceId }],
        proration_behavior: 'create_prorations',
        metadata: {
          ...subscription.metadata,
          userId,
          planType,
          pendingPlanType: '',
          pendingStripePriceId: '',
          pendingChangeEffectiveAt: '',
        },
      });

      await this.applySubscriptionToPlan(userId, planType, updated, {
        lastPlanChangeAt: new Date().toISOString(),
      });

      return { status: 'upgraded', planType };
    }

    const effectiveAt = this.periodEndIso(subscriptionAny);
    await stripe.subscriptions.update(subscription.id, {
      cancel_at_period_end: false,
      metadata: {
        ...subscription.metadata,
        userId,
        planType: plan.type,
        pendingPlanType: planType,
        pendingStripePriceId: priceId,
        pendingChangeEffectiveAt: effectiveAt || '',
      },
    });

    await this.planService.updatePlanMetadata(userId, {
      ...metadata,
      pendingPlanType: planType,
      pendingStripePriceId: priceId,
      pendingChangeEffectiveAt: effectiveAt,
      cancelAtPeriodEnd: false,
    } as Prisma.InputJsonObject);

    return { status: 'downgrade_scheduled', planType, effectiveAt };
  }

  async cancelSubscription(userId: string) {
    const plan = await this.planService.getUserPlan(userId);
    const metadata = this.planMetadata(plan.metadata);
    const subscriptionId = metadata.stripeSubscriptionId as string | undefined;
    if (!subscriptionId || plan.type === PlanType.Free) {
      throw new BadRequestException('No paid subscription to cancel.');
    }

    const stripe = this.getStripe();
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
      metadata: {
        userId,
        planType: plan.type,
        pendingPlanType: PlanType.Free,
      },
    });

    const effectiveAt = this.periodEndIso(subscription as any);
    await this.planService.updatePlanMetadata(userId, {
      ...metadata,
      cancelAtPeriodEnd: true,
      pendingPlanType: PlanType.Free,
      pendingChangeEffectiveAt: effectiveAt,
    } as Prisma.InputJsonObject);

    return { status: 'cancellation_scheduled', effectiveAt };
  }

  async resumeSubscription(userId: string) {
    const plan = await this.planService.getUserPlan(userId);
    const metadata = this.planMetadata(plan.metadata);
    const subscriptionId = metadata.stripeSubscriptionId as string | undefined;
    if (!subscriptionId || plan.type === PlanType.Free) {
      throw new BadRequestException('No subscription to renew.');
    }

    const stripe = this.getStripe();
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
      metadata: {
        userId,
        planType: plan.type,
        pendingPlanType: '',
        pendingStripePriceId: '',
        pendingChangeEffectiveAt: '',
      },
    });

    await this.applySubscriptionToPlan(userId, plan.type, subscription, {
      renewalResumedAt: new Date().toISOString(),
    });

    return { status: 'renewal_resumed', renewsAt: this.periodEndIso(subscription as any) };
  }

  async createPortalSession(userId: string) {
    const plan = await this.planService.getUserPlan(userId);
    const metadata = this.planMetadata(plan.metadata);
    const customer = metadata.stripeCustomerId as string | undefined;
    if (!customer) {
      throw new BadRequestException('No Stripe customer exists for this account yet.');
    }

    const session = await this.getStripe().billingPortal.sessions.create({
      customer,
      return_url: `${this.clientUrl()}/settings?billing=portal`,
    });

    return { url: session.url };
  }

  async handleWebhook(rawBody: Buffer, signature?: string) {
    const stripe = this.getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new BadRequestException('Stripe webhook secret is not configured.');
    }
    if (!signature) {
      throw new BadRequestException('Missing Stripe signature.');
    }

    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    if (event.type === 'checkout.session.completed') {
      await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
    }

    if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      await this.handleSubscriptionChanged(event.data.object as Stripe.Subscription);
    }

    if (event.type === 'invoice.payment_succeeded') {
      await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
    }

    if (event.type === 'invoice.payment_failed') {
      await this.handleInvoiceFailed(event.data.object as Stripe.Invoice);
    }

    return { received: true };
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const userId = session.client_reference_id || session.metadata?.userId;
    const planType = session.metadata?.planType as PlanType | undefined;
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

    if (!userId || !planType || !Object.values(PlanType).includes(planType)) return;

    const subscription = subscriptionId
      ? await this.getStripe().subscriptions.retrieve(subscriptionId)
      : null;

    if (subscription) {
      await this.applySubscriptionToPlan(userId, planType, subscription, {
        stripeCheckoutSessionId: session.id,
      });
      return;
    }

    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    await this.planService.applyPlanToUser(userId, planType, 'active', this.cleanMetadata({
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripeCheckoutSessionId: session.id,
    }));
  }

  private async handleSubscriptionChanged(subscription: Stripe.Subscription) {
    const plan = await this.planService.findByStripeSubscription(subscription.id);
    const userId = subscription.metadata?.userId || plan?.userId;
    if (!userId) return;

    if (subscription.status === 'canceled') {
      await this.applySubscriptionToPlan(userId, PlanType.Free, subscription, {
        previousPlanType: subscription.metadata?.planType || plan?.type,
      });
      return;
    }

    const currentPlanType =
      (subscription.metadata?.planType as PlanType | undefined) ||
      plan?.type ||
      PlanType.Free;

    await this.applySubscriptionToPlan(userId, currentPlanType, subscription);
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice) {
    const subscriptionId = this.invoiceSubscriptionId(invoice);
    if (!subscriptionId) return;

    const stripe = this.getStripe();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const plan = await this.planService.findByStripeSubscription(subscription.id);
    const userId = subscription.metadata?.userId || plan?.userId;
    if (!userId) return;

    const subscriptionAny = subscription as any;
    const metadata = subscription.metadata || {};
    const pendingPlanType = metadata.pendingPlanType as PlanType | undefined;
    const pendingPriceId = metadata.pendingStripePriceId;
    const effectiveAt = metadata.pendingChangeEffectiveAt;
    const periodStart = this.periodStartIso(subscriptionAny);

    if (pendingPlanType && paidPlans.includes(pendingPlanType) && pendingPriceId && this.isDue(periodStart, effectiveAt)) {
      const item = subscription.items.data[0];
      if (item) {
        const updated = await stripe.subscriptions.update(subscription.id, {
          items: [{ id: item.id, price: pendingPriceId }],
          proration_behavior: 'none',
          metadata: {
            ...metadata,
            planType: pendingPlanType,
            pendingPlanType: '',
            pendingStripePriceId: '',
            pendingChangeEffectiveAt: '',
          },
        });

        await this.applySubscriptionToPlan(userId, pendingPlanType, updated, {
          lastRenewedAt: new Date().toISOString(),
        });
        return;
      }
    }

    const planType =
      (metadata.planType as PlanType | undefined) ||
      plan?.type ||
      PlanType.Free;

    await this.applySubscriptionToPlan(userId, planType, subscription, {
      lastRenewedAt: new Date().toISOString(),
    });
  }

  private async handleInvoiceFailed(invoice: Stripe.Invoice) {
    const subscriptionId = this.invoiceSubscriptionId(invoice);
    if (!subscriptionId) return;

    const plan = await this.planService.findByStripeSubscription(subscriptionId);
    if (!plan) return;

    await this.planService.applyPlanToUser(plan.userId, plan.type, 'past_due', {
      ...this.planMetadata(plan.metadata),
      lastPaymentFailedAt: new Date().toISOString(),
    });
  }

  private async applySubscriptionToPlan(
    userId: string,
    planType: PlanType,
    subscription: Stripe.Subscription,
    extraMetadata: Record<string, unknown> = {},
  ) {
    const subscriptionAny = subscription as any;
    const status = this.mapStripeStatus(subscription.status);
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const nextPlanType = status === 'cancelled' ? PlanType.Free : planType;

    await this.planService.applyPlanToUser(userId, nextPlanType, status, this.cleanMetadata({
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
      stripeCurrentPeriodStart: this.periodStartIso(subscriptionAny),
      stripeCurrentPeriodEnd: this.periodEndIso(subscriptionAny),
      renewsAt: subscription.cancel_at_period_end ? null : this.periodEndIso(subscriptionAny),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      pendingPlanType: subscription.metadata?.pendingPlanType || undefined,
      pendingChangeEffectiveAt: subscription.metadata?.pendingChangeEffectiveAt || undefined,
      ...extraMetadata,
    }));
  }

  private getPriceId(planType: PlanType) {
    const planConfig = PLAN_LIMITS[planType as PlanName];
    const stripePriceEnv = 'stripePriceEnv' in planConfig ? planConfig.stripePriceEnv : undefined;
    const priceId = stripePriceEnv ? process.env[stripePriceEnv] : undefined;
    if (!priceId) {
      throw new BadRequestException(`Stripe price is not configured for ${planType}.`);
    }
    return priceId;
  }

  private mapStripeStatus(status: Stripe.Subscription.Status): PlanStatus {
    if (status === 'active') return 'active';
    if (status === 'trialing') return 'trial';
    if (status === 'canceled') return 'cancelled';
    if (status === 'past_due' || status === 'unpaid') return 'past_due';
    return 'expired';
  }

  private invoiceSubscriptionId(invoice: Stripe.Invoice) {
    const invoiceAny = invoice as any;
    const subscription = invoiceAny.subscription || invoiceAny.parent?.subscription_details?.subscription;
    return typeof subscription === 'string' ? subscription : subscription?.id;
  }

  private periodStartIso(subscription: any) {
    return subscription.current_period_start
      ? new Date(subscription.current_period_start * 1000).toISOString()
      : null;
  }

  private periodEndIso(subscription: any) {
    return subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;
  }

  private isDue(periodStart: string | null, effectiveAt?: string) {
    if (!periodStart || !effectiveAt) return false;
    return new Date(periodStart).getTime() >= new Date(effectiveAt).getTime();
  }

  private planMetadata(metadata: unknown) {
    return (metadata as Record<string, unknown> | null) || {};
  }

  private cleanMetadata(metadata: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(metadata).filter(([, value]) => value !== undefined),
    ) as Prisma.InputJsonObject;
  }

  private getStripe() {
    if (this.stripe) return this.stripe;
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new BadRequestException('Stripe is not configured.');
    }

    this.stripe = new Stripe(secretKey);
    return this.stripe;
  }

  private clientUrl() {
    return process.env.CLIENT_URL || 'http://localhost:3000';
  }
}
