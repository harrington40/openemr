import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('OpenRx application (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule =
      await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

    app = moduleFixture.createNestApplication();
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
