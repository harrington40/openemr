import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  username: process.env.DB_USERNAME || 'openemr',
  password: process.env.DB_PASSWORD || 'openemr',
  database: process.env.DB_DATABASE || 'openemr',
}));
