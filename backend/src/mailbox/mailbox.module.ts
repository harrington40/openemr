import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MailboxController } from './mailbox.controller';
import { MailboxService } from './mailbox.service';
import { MailboxSchedulerService } from './mailbox-scheduler.service';

@Module({
    // HttpService is used to stream archives back out of B2 on restore, so this
    // module registers its own HttpModule rather than relying on another module's.
    imports: [HttpModule.register({ timeout: 60000, maxRedirects: 5 })],
    controllers: [MailboxController],
    providers: [MailboxService, MailboxSchedulerService],
    exports: [MailboxService],
})
export class MailboxModule {}
