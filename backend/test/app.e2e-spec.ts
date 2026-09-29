import { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Booting the entire AppModule runs each service's ensure-schema pass, which is
// a long chain of sequential round trips. Jest's 5s default is ample against a
// local database but not against a remote one — when CI points the tests at a
// database reached over the network, the beforeEach hook was timing out before
// the application had finished starting.
jest.setTimeout(120_000);

describe('OpenRx application (e2e)', () => {
    let app: INestApplication<Server>;

    beforeEach(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication<INestApplication<Server>>();
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it('GET /config returns application configuration', async () => {
        return request(app.getHttpServer())
            .get('/config')
            .expect(200)
            .expect((response) => {
                expect(response.body).toEqual({
                    language: 'en',
                    appName: 'OpenRx',
                    version: '1.0.0',
                });
            });
    });
});
