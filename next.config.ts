import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // O client gerado pelo Prisma 7 é ESM e vive fora de node_modules; o Next
  // precisa saber que ele não deve ser empacotado no bundle do servidor.
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg'],
};

export default nextConfig;
