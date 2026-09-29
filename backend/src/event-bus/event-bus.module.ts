import { Module, DynamicModule, Global } from '@nestjs/common';
import type { IEventBus, EventBusModuleOptions } from './event-bus.interface';
import { InMemoryBusService } from './in-memory-bus.service';
import { KafkaBusService } from './kafka-bus.service';

/**
 * Global event bus module.
 *
 * Development (default):
 *   EventBusModule.forRoot()  // or { adapter: 'in-memory' }
 *
 * Production:
 *   EventBusModule.forRoot({
 *     adapter: 'kafka',
 *     brokers: ['kafka1:9092', 'kafka2:9092'],
 *     clientId: 'openemr-prod',
 *   })
 */
@Global()
@Module({})
export class EventBusModule {
    static forRoot(options?: EventBusModuleOptions): DynamicModule {
        const opts: EventBusModuleOptions = {
            adapter: 'in-memory',
            brokers: ['localhost:9092'],
            clientId: 'openrx',
            ...options,
        };

        if (opts.adapter === 'in-memory') {
            return {
                module: EventBusModule,
                providers: [
                    {
                        provide: 'EVENT_BUS',
                        useClass: InMemoryBusService,
                    },
                    InMemoryBusService,
                ],
                exports: ['EVENT_BUS', InMemoryBusService],
            };
        }

        // Kafka adapter
        return {
            module: EventBusModule,
            providers: [
                {
                    provide: 'KAFKA_BROKERS',
                    useValue: opts.brokers || ['localhost:9092'],
                },
                {
                    provide: 'KAFKA_CLIENT_ID',
                    useValue: opts.clientId || 'openrx',
                },
                {
                    provide: 'KAFKA_GROUP_ID',
                    useValue: `${opts.clientId || 'openrx'}-group`,
                },
                {
                    provide: 'EVENT_BUS',
                    useFactory: (
                        brokers: string[],
                        clientId: string,
                        groupId: string,
                    ): IEventBus => {
                        return new KafkaBusService(brokers, clientId, groupId);
                    },
                    inject: [
                        'KAFKA_BROKERS',
                        'KAFKA_CLIENT_ID',
                        'KAFKA_GROUP_ID',
                    ],
                },
            ],
            exports: ['EVENT_BUS'],
        };
    }
}
