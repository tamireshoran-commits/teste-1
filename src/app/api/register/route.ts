import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/prisma';
import { logger } from '@/server/core/shared/logger';

const log = logger.child('api:register');

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(120),
  email: z.string().email('E-mail inválido').toLowerCase().trim(),
  password: z.string().min(8, 'A senha deve ter ao menos 8 caracteres').max(200),
});

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Corpo da requisição inválido' },
      { status: 400 },
    );
  }

  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Dados inválidos',
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: 'Já existe uma conta com este e-mail' },
      { status: 409 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: { name, email, passwordHash },
    select: { id: true, email: true, name: true },
  });

  log.info('usuário registrado', { userId: user.id });

  return NextResponse.json({ user }, { status: 201 });
}
