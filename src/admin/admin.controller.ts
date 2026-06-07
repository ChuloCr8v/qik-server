import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthUser, CurrentUser } from "../common/auth-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { AdminService } from "./admin.service";
import { AdminGuard } from "./guards/admin.guard";
import { PlatformSuperAdminGuard } from "./guards/platform-superadmin.guard";
import { AdminAuditQueryDto, AdminListQueryDto } from "./dto/admin-query.dto";
import { UpdateAdminMeetingDto } from "./dto/update-admin-meeting.dto";
import { UpdateAdminUserDto } from "./dto/update-admin-user.dto";

@Controller("admin")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.adminService.adminMe(user.id);
  }

  @Get("overview")
  overview() {
    return this.adminService.overview();
  }

  @Get("users")
  users(@Query() query: AdminListQueryDto) {
    return this.adminService.users(query);
  }

  @Get("users/:id")
  user(@Param("id") id: string) {
    return this.adminService.userDetail(id);
  }

  @Patch("users/:id")
  @UseGuards(PlatformSuperAdminGuard)
  updateUser(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: UpdateAdminUserDto,
  ) {
    return this.adminService.updateUser(user.id, id, body);
  }

  @Get("meetings")
  meetings(@Query() query: AdminListQueryDto) {
    return this.adminService.meetings(query);
  }

  @Get("meetings/:id")
  meeting(@Param("id") id: string) {
    return this.adminService.meetingDetail(id);
  }

  @Patch("meetings/:id")
  updateMeeting(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: UpdateAdminMeetingDto,
  ) {
    return this.adminService.updateMeeting(user.id, id, body);
  }

  @Delete("meetings/:id")
  @UseGuards(PlatformSuperAdminGuard)
  deleteMeeting(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.adminService.deleteMeeting(user.id, id);
  }

  @Get("billing")
  billing() {
    return this.adminService.billing();
  }

  @Post("billing/sync/:userId")
  @UseGuards(PlatformSuperAdminGuard)
  syncBilling(@CurrentUser() user: AuthUser, @Param("userId") userId: string) {
    return this.adminService.syncBilling(user.id, userId);
  }

  @Get("usage")
  usage() {
    return this.adminService.usage();
  }

  @Get("system-health")
  systemHealth() {
    return this.adminService.systemHealth();
  }

  @Get("audit-logs")
  auditLogs(@Query() query: AdminAuditQueryDto) {
    return this.adminService.auditLogs(query);
  }
}
