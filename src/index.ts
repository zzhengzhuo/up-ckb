import {
  Address,
  Amount,
  Builder,
  DefaultSigner,
  IndexerCollector,
  RPC,
  Transaction,
} from '@lay2/pw-core';

import { config, getConfig } from './config';
import { UPCKBBaseProvider } from './providers';
import { sendUPLockTransaction } from './up-lock-proof';
import { UPLockSimpleBuilder } from './up-lock-simple-builder';
import { UPLockMigratorBuilder } from './up-lock-migrator-builder';
import { IndexerMigratorCollector } from './indexer-migrator-provider';

/**
 * get UniPass user's CKB asset address
 *
 * @param username UniPass username
 * @returns user's CKB asset address
 */
function getCKBAddress(username: string): Address {
  const provider = new UPCKBBaseProvider(username, getConfig().upLockCodeHash);
  return provider.address;
}

/**
 * send CKB to a specified address using UPCKBBaseProvider
 *
 * @param to the destination CKB address
 * @param amount the amount of CKB to be sent
 * @param provider the PWCore Provider used to sign transaction
 * @returns the transaction hash
 */
async function sendCKB(
  to: Address,
  amount: Amount,
  provider: UPCKBBaseProvider
): Promise<string> {
  const builder = new UPLockSimpleBuilder(to, amount, provider!, {
    collector: new IndexerCollector(getConfig().ckbIndexerUrl),
    witnessArgs: Builder.WITNESS_ARGS.RawSecp256k1,
  });
  const tx = await builder.build();

  return sendTransaction(tx, provider!);
}

async function migrate(
  to: Address,
  provider: UPCKBBaseProvider,
  cellLimit: number = 100
): Promise<string[]> {
  const builder = new UPLockMigratorBuilder(to, provider!, {
    collector: new IndexerMigratorCollector(getConfig().ckbIndexerUrl),
    witnessArgs: Builder.WITNESS_ARGS.RawSecp256k1,
  });
  const txs = await builder.buildTxs(cellLimit);

  const txHashes = [];
  let txHash = undefined;
  for (const tx of txs) {
    if (
      tx.raw.inputCells[tx.raw.inputCells.length - 1].outPoint?.txHash ==
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    ) {
      tx.raw.inputCells[tx.raw.inputCells.length - 1].outPoint.txHash = txHash;
      tx.raw.inputs[tx.raw.inputCells.length - 1].previousOutput.txHash =
        txHash;
    }
    txHash = await sendTransaction(tx, provider!);
    txHashes.push(txHash);
  }

  return txHashes;
}

/**
 * sign and send a CKB transaction with UPCKBBaseProvider
 * @param tx
 * @param provider
 * @returns
 */
async function sendTransaction(
  tx: Transaction,
  provider: UPCKBBaseProvider
): Promise<string> {
  // TODO: save old cell deps and restore old cell deps after complete tx
  const oldCellDeps = tx.raw.cellDeps;
  tx.raw.cellDeps = [];
  const signer = new DefaultSigner(provider);
  const signedTx = await signer.sign(tx);
  signedTx.raw.cellDeps = signedTx.raw.cellDeps.concat(oldCellDeps);

  const rpc = new RPC(getConfig().ckbNodeUrl);
  return sendUPLockTransaction(provider.usernameHash, signedTx, rpc);
}

export * from './up-lock-proof';
export * from './providers';
const functions = {
  config,
  getCKBAddress,
  sendCKB,
  sendTransaction,
  migrate,
};
export default functions;
