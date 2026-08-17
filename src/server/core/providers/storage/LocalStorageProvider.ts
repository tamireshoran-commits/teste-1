import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { AppError, InvalidInputError, NotFoundError } from '@/server/core/shared/errors';
import type {
  StorageObject,
  StorageProvider,
  StoragePutInput,
} from './StorageProvider';

/**
 * Armazenamento em disco local, para desenvolvimento e para o MVP em uma
 * única máquina. Trocar por S3/R2 é implementar `StorageProvider` e mudar a
 * env `STORAGE_PROVIDER` — nada fora desta pasta muda.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'LocalStorageProvider';
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  async put(input: StoragePutInput): Promise<StorageObject> {
    const path = this.resolveKey(input.key);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.data);

    return {
      key: input.key,
      sizeBytes: input.data.byteLength,
      contentType: input.contentType,
    };
  }

  async get(key: string): Promise<Uint8Array> {
    const path = this.resolveKey(key);

    try {
      return await readFile(path);
    } catch (cause) {
      if (isNotFound(cause)) throw new NotFoundError('Arquivo', key);

      throw new AppError(`Falha ao ler o arquivo "${key}"`, {
        code: 'UNKNOWN',
        cause,
      });
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Converte a chave lógica em caminho absoluto, recusando qualquer coisa que
   * escape da raiz.
   *
   * A checagem é feita no caminho já resolvido, e não por busca de `..` na
   * string: normalizações e separadores diferentes fariam um filtro textual
   * passar batido.
   */
  private resolveKey(key: string): string {
    if (key.trim() === '') {
      throw new InvalidInputError('A chave de armazenamento não pode ser vazia.');
    }

    if (isAbsolute(key) || key.includes('\0')) {
      throw new InvalidInputError(
        `Chave de armazenamento inválida: "${key}"`,
        'INVALID_INPUT',
        { key },
      );
    }

    const path = resolve(this.rootDir, normalize(key));

    if (path !== this.rootDir && !path.startsWith(this.rootDir + sep)) {
      throw new InvalidInputError(
        `Chave de armazenamento tentou escapar do diretório raiz: "${key}"`,
        'INVALID_INPUT',
        { key },
      );
    }

    return path;
  }

  /** Caminho lógico padrão das fotos de uma análise. */
  static photoKey(analysisId: string, photoId: string, extension: string): string {
    return join('analyses', analysisId, 'photos', `${photoId}.${extension}`);
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
