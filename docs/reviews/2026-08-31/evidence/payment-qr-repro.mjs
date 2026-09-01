import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { Amounts, TxBuilder, TxType, Network, ZERO_ADDRESS, PrivateKey, encodeTx, bytesToHex, DECIMALS, decodeTx } from '@goldenera/cryptoj';
const src=fs.readFileSync('src/components/TxSubmitCard.tsx','utf8');
const fn=src.slice(src.indexOf('    const onConfirm = async () => {'),src.indexOf('    const rootError ='));
const js=ts.transpileModule(fn+'\nreturn onConfirm;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
const a=deferred(),b=deferred(),bal=deferred();let reads=0,submits=[];
const bindings={Amounts,TxBuilder,TxType,Network,ZERO_ADDRESS,PrivateKey,encodeTx,bytesToHex,DECIMALS,
 reviewData:{tokenAddress:ZERO_ADDRESS,recipient:'0x'+'22'.repeat(20),amount:'1',fee:'standard'},privateKey:PrivateKey.wrap('0x'+'01'.repeat(32)),
 refetchNextNonce:()=>++reads===1?a.promise:b.promise,
 refetchBalances:()=>bal.promise,recommendedFees:{standard:{baseFee:'1000',feePerByte:'10',totalForAverageTx:'2500'}},
 getBalanceFromData:()=>({balance:'1000000000000'}),calculateFee:()=>2500n,tokenDecimals:8,nativeTokenSymbol:'GE',isNativeToken:x=>x===ZERO_ADDRESS,
 submitTx:async({data})=>{submits.push(decodeTx(data.hexData).nonce);return {status:'SUCCESS'};},setSubmitError:()=>{},setReviewData:()=>{},onSuccess:null,onError:null,pop:()=>{}};
const confirm=new Function(...Object.keys(bindings),js)(...Object.values(bindings));
const first=confirm();a.resolve({data:1});await Promise.resolve();
const second=confirm(); // UI still enabled: first awaits balances, no mutate in flight.
bal.resolve({data:[]});
while(submits.length===0)await new Promise(r=>setTimeout(r,1));
b.resolve({data:2}); // second nonce response after first submit accepted.
await Promise.all([first,second]);
assert.deepEqual(submits,[1n,2n]);console.log('Two confirmations before first submit produced two separately signed payments with nonces 1 and 2 (mock API only).');
const qsrc=fs.readFileSync('src/pages/ScanQrCodePage.tsx','utf8');
const body=qsrc.slice(qsrc.indexOf('        // Prevent double navigation from multiple scans'),qsrc.indexOf('    }, [replace, stopScan]'));
const hasNavigated={current:false};let stopped=0,replaced=0;
const onScan=new Function('hasNavigated','stringToQrData','stopScan','replace','return (data)=>{'+body+'}')(hasNavigated,()=>{throw new Error('Invalid QR')},()=>stopped++,()=>replaced++);
assert.throws(()=>onScan('unrelated QR'));assert.equal(hasNavigated.current,true);onScan('valid QR now ignored');assert.equal(replaced,0);assert.equal(stopped,0);
console.log('Invalid QR leaves hasNavigated=true, valid scan ignored and scanner not stopped.');
