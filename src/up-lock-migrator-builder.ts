import {
  Address,
  Amount,
  AmountUnit,
  Builder,
  BuilderOption,
  Cell,
  CellDep,
  DepType,
  OutPoint,
  Provider,
  RawTransaction,
  Transaction,
} from '@lay2/pw-core';

export const CellDeps = new Map([
  // testnet mnft
  [
    '0xb1837b5ad01a88558731953062d1f5cb547adf89ece01e8934a9f0aeed2d959f',
    new CellDep(
      DepType.code,
      new OutPoint(
        '0xf11ccb6079c1a4b3d86abe2c574c5db8d2fd3505fdc1d5970b69b31864a4bd1c',
        '0x2'
      )
    ),
  ],
  // testnet sudt
  [
    '0xc5e5dcf215925f7ef4dfaf5f4b4f105bc321c02776d6e7d52a1db3fcd9d011a4',
    new CellDep(
      DepType.code,
      new OutPoint(
        '0xe12877ebd2c3c364dc46c5c992bcfaf4fee33fa13eebdf82c591fc9825aab769',
        '0x0'
      )
    ),
  ],
  // testnet NRC721
  [
    '0x679d5c7bd2476108f973560c816f71afb8fb4486cadac31cbc0664a2c59ff104',
    new CellDep(
      DepType.code,
      new OutPoint(
        '0xf06234027d9a7685c2e40da694f3f5d994e542adcc0bb7477bc9889685fee784',
        '0x0'
      )
    ),
  ],
  // mainnet mnft
  [
    '0x2b24f0d644ccbdd77bbf86b27c8cca02efa0ad051e447c212636d9ee7acaaec9',
    new CellDep(
      DepType.code,
      new OutPoint(
        '0x5dce8acab1750d4790059f22284870216db086cb32ba118ee5e08b97dc21d471',
        '0x2'
      )
    ),
  ],
  // mainnet sudt
  [
    '0x5e7a36a77e68eecc013dfa2fe6a23f3b6c344b04005808694ae6dd45eea4cfd5',
    new CellDep(
      DepType.code,
      new OutPoint(
        '0xc7813f6a415144643970c2e88e0bb6ca6a8edc5dd7c1022746f628284a9936d5',
        '0x0'
      )
    ),
  ],
  // mainnet NRC721
  [
    '0x72fd858dd56f552a7ef10fb61886311d0ca95e3970c0af18a412aff0903c1a9e',
    new CellDep(
      DepType.code,
      new OutPoint(
        '0xb85f64679b43e6742ff2b874621d1d75c9680961c94de8187364474d637eddab',
        '0x0'
      )
    ),
  ],
]);

export class UPLockMigratorBuilder extends Builder {
  constructor(
    private readonly address: Address,
    protected readonly provider: Provider,
    protected readonly options: BuilderOption = {}
  ) {
    super(options.feeRate, options.collector, options.witnessArgs);
  }

  async build(): Promise<Transaction> {
    throw new Error('Please use `buildTxs` instead');
  }

  async buildTxs(cellLimit: number = 100): Promise<Transaction[]> {
    if (cellLimit <= 1) {
      throw new Error('Cell limit should greater than `1`');
    }

    const feeSufficientCells: Cell[] = [];
    const feeInsufficientCells: Cell[] = [];
    const fee = new Amount('0.01', AmountUnit.ckb);
    const cellDepsMap: Map<string, CellDep> = new Map();

    // fill the inputs
    const cells = await this.collector.collect(this.provider.address);
    for (const cell of cells) {
      if (cell.type) {
        const codeHash = cell.type.codeHash.toLowerCase();
        const cellDep = CellDeps.get(codeHash);
        if (!cellDep) {
          continue;
        }
        cellDepsMap.set(codeHash, cellDep);
      }
      if (cell.availableFee().gt(fee)) {
        feeSufficientCells.push(cell);
      } else {
        feeInsufficientCells.push(cell);
      }
    }

    feeSufficientCells.sort((a, b) => {
      const aAvailableFee = a.availableFee();
      const bAvailableFee = b.availableFee();
      if (aAvailableFee.gt(bAvailableFee)) {
        return 1;
      } else if (aAvailableFee.eq(bAvailableFee)) {
        return 0;
      } else {
        return -1;
      }
    });
    if (feeSufficientCells.length + feeInsufficientCells.length == 0) {
      return [];
    }
    if (feeSufficientCells.length < 1) {
      throw new Error('Expected fee sufficient cells');
    }
    const cellDeps = [...cellDepsMap.values()];

    const txs: Transaction[] = [];
    if (feeSufficientCells.length + feeInsufficientCells.length <= cellLimit) {
      const inputCells = feeSufficientCells.concat(feeInsufficientCells);
      let outputCells = inputCells.map((cell) => {
        return new Cell(
          cell.capacity,
          this.address.toLockScript(),
          cell.type,
          cell.outPoint,
          cell.getHexData()
        );
      });

      let tx = new Transaction(
        new RawTransaction(inputCells, outputCells, cellDeps),
        [this.witnessArgs]
      );
      const fee = Builder.calcFee(tx, this.feeRate).add(
        new Amount('100000', AmountUnit.shannon)
      );
      const feeCell = outputCells[outputCells.length - 1];
      outputCells[outputCells.length - 1] = new Cell(
        feeCell.capacity.sub(fee),
        feeCell.lock,
        feeCell.type,
        feeCell.outPoint,
        feeCell.getHexData()
      );
      tx = new Transaction(
        new RawTransaction(inputCells, outputCells, cellDeps),
        [this.witnessArgs]
      );
      txs.push(tx);
    } else {
      let feeCell: Cell = feeSufficientCells.pop();
      const cells = feeSufficientCells.concat(feeInsufficientCells);

      let i = 0;
      let migrateCellLimit = cellLimit - 1;
      while (cells.length > i * migrateCellLimit) {
        const migrateCells = cells.slice(
          i * migrateCellLimit,
          i * migrateCellLimit + migrateCellLimit
        );
        let inputCells = [].concat(migrateCells);
        inputCells.push(feeCell);
        let outputCells = migrateCells.map(
          (cell) =>
            new Cell(
              cell.capacity,
              this.address.toLockScript(),
              cell.type,
              cell.outPoint,
              cell.getHexData()
            )
        );
        outputCells.push(
          new Cell(
            feeCell.capacity,
            feeCell.lock,
            feeCell.type,
            feeCell.outPoint,
            feeCell.getHexData()
          )
        );
        let tx = new Transaction(
          new RawTransaction(inputCells, outputCells, cellDeps),
          [this.witnessArgs]
        );
        const fee = Builder.calcFee(tx, this.feeRate).add(
          new Amount('100000', AmountUnit.shannon)
        );
        const changeCell = new Cell(
          feeCell.capacity.sub(fee),
          feeCell.lock,
          feeCell.type,
          feeCell.outPoint,
          feeCell.getHexData()
        );
        outputCells[outputCells.length - 1] = changeCell;
        tx = new Transaction(
          new RawTransaction(inputCells, outputCells, cellDeps),
          [this.witnessArgs]
        );
        txs.push(tx);
        feeCell = new Cell(
          changeCell.capacity,
          changeCell.lock,
          changeCell.type,
          new OutPoint(
            '0x0000000000000000000000000000000000000000000000000000000000000000',
            `0x${(outputCells.length - 1).toString(16)}`
          ),
          changeCell.getHexData()
        );
        i++;
      }
      const lastTx = txs[txs.length - 1];
      lastTx.raw.outputs[lastTx.raw.outputs.length - 1].lock =
        this.address.toLockScript();
    }

    console.log('txs', txs);
    return txs;
  }

  getCollector() {
    return this.collector;
  }
}
