import {
  Address,
  Amount,
  AmountUnit,
  Cell,
  IndexerCellToCell,
  IndexerCollector,
  ScriptType,
  SnakeScript,
} from '@lay2/pw-core';

export class IndexerMigratorCollector extends IndexerCollector {
  constructor(public apiBase: string) {
    super(apiBase);
  }

  override async collect(address: Address): Promise<Cell[]> {
    const searchKey = {
      script: address.toLockScript().serializeJson() as SnakeScript,
      script_type: ScriptType.lock,
    };
    const cells = await (this as any).indexer.getCells(searchKey);
    return cells.map((cell) => IndexerCellToCell(cell));
  }

  async getBalance(address: Address): Promise<Amount> {
    const searchKey = {
      script: address.toLockScript().serializeJson() as SnakeScript,
      script_type: ScriptType.lock,
    };
    const cells = (await (this as any).indexer.getCells(searchKey)).filter(
      (cell) => cell.output.type === null
    );
    let balance = Amount.ZERO;
    cells.forEach((cell) => {
      const amount = new Amount(cell.output.capacity, AmountUnit.shannon);
      balance = balance.add(amount);
    });
    return balance;
  }
}
