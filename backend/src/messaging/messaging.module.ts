import { Module } from '@nestjs/common';
import { MessagingGateway } from './messaging-gateway';
import { MessageProducer } from './message-producer.service';
import { MessageConsumer } from './message-consumer.service';
import { DedupEngine } from './dedup-engine.service';
import { PriorityEscalationService } from './priority-escalation.service';
import { EventBusModule } from '../event-bus/event-bus.module';

@Module({
    imports: [EventBusModule.forRoot()],
    providers: [
        MessagingGateway,
        MessageProducer,
        MessageConsumer,
        DedupEngine,
        PriorityEscalationService,
    ],
    exports: [MessageProducer, MessagingGateway],
})
export class MessagingModule {}
