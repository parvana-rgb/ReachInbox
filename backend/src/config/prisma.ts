import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from './env';

const url = new URL(env.DATABASE_URL);
const schema = url.searchParams.get('schema') ?? 'public';
url.searchParams.delete('schema');
const adapter = new PrismaPg({ connectionString: url.toString() }, { schema });
export const prisma = new PrismaClient({ adapter });
