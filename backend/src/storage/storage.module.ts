import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { B2StorageService } from './b2-storage.service';

@Global()
@Module({
    imports: [
        HttpModule.register({
            timeout: 60000,
            maxRedirects: 5,
        }),
    ],
    providers: [B2StorageService],
    exports: [B2StorageService],
})
export class StorageModule {}
