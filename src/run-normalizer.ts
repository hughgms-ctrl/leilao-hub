import { processarPendentes, fechar } from './normalizer';
import { connectionStringDireta } from './pg-config';

/**
 * Uso: DIRECT_DATABASE_URL=postgres://... npx tsx src/run-normalizer.ts
 * (aqui o banco é obrigatório — normalizer sem banco não faz sentido)
 */
async function main() {
  if (!connectionStringDireta()) {
    console.error('DIRECT_DATABASE_URL e obrigatorio para o normalizer.');
    process.exit(1);
  }
  try {
    await processarPendentes();
  } finally {
    await fechar();
  }
}

main();
