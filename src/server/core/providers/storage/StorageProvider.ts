/**
 * Contrato de armazenamento de arquivos (fotos e CSVs).
 *
 * O MVP grava em disco local; trocar por S3/R2 depois é implementar esta
 * interface e mudar a env `STORAGE_PROVIDER`.
 */
export interface StorageProvider {
  readonly name: string;

  /** Grava e devolve a chave para recuperar o arquivo. */
  put(input: StoragePutInput): Promise<StorageObject>;

  get(key: string): Promise<Uint8Array>;

  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;
}

export interface StoragePutInput {
  /**
   * Caminho lógico, ex.: `analyses/<id>/photos/<uuid>.jpg`.
   * A implementação deve rejeitar chaves com `..` para evitar path traversal.
   */
  key: string;
  data: Uint8Array;
  contentType: string;
}

export interface StorageObject {
  key: string;
  sizeBytes: number;
  contentType: string;
}
