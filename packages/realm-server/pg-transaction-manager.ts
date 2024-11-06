import PgAdapter from './pg-adapter';

export class TransactionManager {
  private isInTransaction = false;

  constructor(private client: PgAdapter) {}

  async begin(): Promise<void> {
    if (this.isInTransaction) {
      throw new Error('Transaction already in progress');
    }
    await this.client.execute('BEGIN');
    this.isInTransaction = true;
  }

  async commit(): Promise<void> {
    if (!this.isInTransaction) {
      throw new Error('No transaction in progress');
    }
    await this.client.execute('COMMIT');
    this.isInTransaction = false;
  }

  async rollback(): Promise<void> {
    if (!this.isInTransaction) {
      throw new Error('No transaction in progress');
    }
    await this.client.execute('ROLLBACK');
    this.isInTransaction = false;
  }

  async withTransaction<T>(
    callback: (client: PgAdapter) => Promise<T>,
  ): Promise<T> {
    try {
      await this.begin();
      const result = await callback(this.client);
      await this.commit();
      return result;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }
}
