import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Inject, OnModuleInit } from '@nestjs/common';
import type { IEventBus, BusEvent } from '../event-bus/event-bus.interface';

/**
 * WebSocket Gateway for real-time messaging.
 *
 * Pushes new messages, status updates, and notifications
 * to connected clients via socket.io.
 *
 * Client connects to: ws://localhost:3002/messaging
 * (namespace: /messaging)
 */
@WebSocketGateway({
  namespace: '/messaging',
  // Served under /messaging so the nginx `location /messaging/` proxy
  // forwards socket.io handshakes to this server in production.
  path: '/messaging/socket.io',
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:8082'],
    credentials: true,
  },
})
export class MessagingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(MessagingGateway.name);

  /** Track connected clients: socketId → { userId, subscribedTopics } */
  private readonly clients = new Map<
    string,
    { userId?: number; subscribedTopics: Set<string> }
  >();

  constructor(
    @Inject('EVENT_BUS') private readonly eventBus: IEventBus,
  ) {}

  async onModuleInit(): Promise<void> {
    // Bridge event bus → WebSocket
    // When any message/event is published, push to relevant connected clients
    const topics = [
      'openrx.messages.clinic',
      'openrx.messages.patient',
      'openrx.messages.patient-chat',
      'openrx.events.appointments',
      'openrx.events.patients',
      'openrx.events.clinical',
      'openrx.notifications.email',
      'openrx.notifications.sms',
      'openrx.direct.hl7',
    ];

    for (const topic of topics) {
      await this.eventBus.subscribe(topic, (event: BusEvent) => {
        this.broadcastToTopic(topic, event);
      });
    }

    this.logger.log('WebSocket gateway bridged to event bus');
  }

  afterInit(): void {
    this.logger.log('WebSocket gateway initialized');
  }

  handleConnection(client: Socket): void {
    this.clients.set(client.id, { subscribedTopics: new Set() });
    this.logger.log(`Client connected: ${client.id} (total: ${this.clients.size})`);

    // Send welcome message
    client.emit('connected', {
      message: 'Connected to OpenRx Messaging',
      clientId: client.id,
      timestamp: new Date().toISOString(),
    });
  }

  handleDisconnect(client: Socket): void {
    this.clients.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id} (total: ${this.clients.size})`);
  }

  /**
   * Client subscribes to specific topic(s).
   * payload: { topics: string[] }
   */
  @SubscribeMessage('subscribe')
  handleSubscribe(
    @MessageBody() payload: { topics: string[] },
    @ConnectedSocket() client: Socket,
  ): void {
    const entry = this.clients.get(client.id);
    if (!entry) return;

    for (const topic of payload.topics) {
      entry.subscribedTopics.add(topic);
    }

    client.emit('subscribed', { topics: Array.from(entry.subscribedTopics) });
    this.logger.debug(`Client ${client.id} subscribed to: ${payload.topics.join(', ')}`);
  }

  /**
   * Client unsubscribes from specific topic(s).
   */
  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @MessageBody() payload: { topics: string[] },
    @ConnectedSocket() client: Socket,
  ): void {
    const entry = this.clients.get(client.id);
    if (!entry) return;

    for (const topic of payload.topics) {
      entry.subscribedTopics.delete(topic);
    }

    client.emit('unsubscribed', { topics: Array.from(entry.subscribedTopics) });
  }

  /**
   * Client sends a ping to keep the connection alive.
   */
  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket): void {
    client.emit('pong', { timestamp: new Date().toISOString() });
  }

  /**
   * Set user context for a connection (so we can do targeted pushes).
   */
  @SubscribeMessage('identify')
  handleIdentify(
    @MessageBody() payload: { userId: number },
    @ConnectedSocket() client: Socket,
  ): void {
    const entry = this.clients.get(client.id);
    if (entry) {
      entry.userId = payload.userId;
    }
  }

  // ---- private helpers ----

  private broadcastToTopic(topic: string, event: BusEvent): void {
    // Build a clean event for the frontend
    const frontendEvent = {
      topic,
      eventId: event.eventId,
      type: event.type,
      priority: event.priority,
      timestamp: event.timestamp,
      payload: event.payload,
    };

    // Send to all clients subscribed to this topic
    for (const [socketId, entry] of this.clients.entries()) {
      if (entry.subscribedTopics.has(topic) || entry.subscribedTopics.has('*')) {
        try {
          this.server.to(socketId).emit('event', frontendEvent);
        } catch (err) {
          this.logger.warn(`Failed to send to client ${socketId}: ${err}`);
        }
      }
    }

    // Also broadcast as a general 'message' event for the global inbox
    if (event.type === 'message') {
      this.server.emit('new_message', frontendEvent);
    }

    // Broadcast notifications to all
    if (event.type === 'notification') {
      this.server.emit('notification', frontendEvent);
    }
  }
}
