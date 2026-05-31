import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { Logger } from "@nestjs/common";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const allowedOrigins = (
    process.env.CORS_ORIGIN ||
    process.env.CLIENT_URL ||
    "http://localhost:3000" ||
    "http://localhost:3100"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: "*",
    // credentials: true,
  });

  const port = Number(process.env.PORT || 4000);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}`,
    "Bootstrap",
  );
  await app.listen(port);
}

bootstrap();
