import assert from 'node:assert/strict';
import { Amounts, TxBuilder, TxType, Network, ZERO_ADDRESS, PrivateKey, encodeTx } from '@goldenera/cryptoj';
const key = PrivateKey.wrap('0x' + '01'.repeat(32));
for (const nonce of [1n, 1000000n]) {
 for (const amount of [100000000n, 1000000000000000000n]) {
  const tx = TxBuilder.create().type(TxType.TRANSFER).network(Network.MAINNET).recipient('0x' + '22'.repeat(20)).amount(amount).fee(2500n).nonce(nonce).tokenAddress(ZERO_ADDRESS).sign(key);
  const size=encodeTx(tx,true).length;
  console.log(JSON.stringify({nonce:String(nonce),amount:String(amount),size,fee:'2500',minimumAtBase1000Byte10:String(1000n+BigInt(size)*10n)}));
 }
}
const input='0.000000001';
assert.equal(Amounts.isPositive(Amounts.parseTokens(input)),false);
assert.equal(Amounts.parseWithDecimals(input,18),1000000000n);
console.log('amount schema rejects valid positive 18-decimal-token amount: confirmed');
