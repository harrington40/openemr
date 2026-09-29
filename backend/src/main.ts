import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    // Enable WebSocket support via Socket.io
    app.useWebSocketAdapter(new IoAdapter(app));

    // Enable CORS for the React SPA (Vite dev server)
    app.enableCors({
        origin: ['http://localhost:5173', 'http://localhost:8082'],
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        credentials: true,
    });

    // Enable global validation
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            transform: true,
            forbidNonWhitelisted: true,
        }),
    );

    // Set global prefix for the API (does NOT affect WebSocket gateways)
    app.setGlobalPrefix('api');

    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`OpenRx backend running on http://localhost:${port}/api`);
    console.log(`WebSocket gateway on ws://localhost:${port}/messaging`);
}
void bootstrap();
