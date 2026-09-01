import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { Amounts, TxBuilder, TxType, Network, ZERO_ADDRESS, PrivateKey, encodeTx, bytesToHex, DECIMALS, decodeTx } from '@goldenera/cryptoj';
const src=fs.readFileSync('/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/components/TxSubmitCard.tsx','utf8');
const fn=src.slice(src.indexOf('    const onConfirm = async () => {'),src.indexOf('    const rootError ='));
const js=ts.transpileModule(fn+'\nreturn onConfirm;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise}};
const firstNonce=deferred(),secondNonce=deferred(),firstBalance=deferred(),balanceStarted=deferred(),submittedFirst=deferred();
let nonceFetches=0,balanceFetches=0,nonceAborts=0,submits=[];
const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
const nonceObserver=new QueryObserver(client,{queryKey:['nonce'],enabled:false,initialData:1,queryFn:({signal})=>{signal.addEventListener('abort',()=>nonceAborts++);return ++nonceFetches===1?firstNonce.promise:secondNonce.promise}});
const balancesObserver=new QueryObserver(client,{queryKey:['balances'],enabled:false,initialData:[],queryFn:({signal})=>{balanceFetches++;if(balanceFetches===1){balanceStarted.resolve();return firstBalance.promise}return Promise.resolve([])}});
const offNonce=nonceObserver.subscribe(()=>{}),offBalances=balancesObserver.subscribe(()=>{});
const bindings={Amounts,TxBuilder,TxType,Network,ZERO_ADDRESS,PrivateKey,encodeTx,bytesToHex,DECIMALS,
 reviewData:{tokenAddress:ZERO_ADDRESS,recipient:'0x'+'22'.repeat(20),amount:'1',fee:'standard'},privateKey:PrivateKey.wrap('0x'+'01'.repeat(32)),
 refetchNextNonce:nonceObserver.refetch,refetchBalances:balancesObserver.refetch,
 recommendedFees:{standard:{baseFee:'1000',feePerByte:'10',totalForAverageTx:'2500'}},
 getBalanceFromData:()=>({balance:'1000000000000'}),calculateFee:()=>2500n,tokenDecimals:8,nativeTokenSymbol:'GE',isNativeToken:x=>x===ZERO_ADDRESS,
 submitTx:async({data})=>{submits.push(decodeTx(data.hexData).nonce);submittedFirst.resolve();return {status:'SUCCESS'}},
 setSubmitError:()=>{},setReviewData:()=>{},onSuccess:null,onError:e=>{throw e},pop:()=>{}};
const confirm=new Function(...Object.keys(bindings),js)(...Object.values(bindings));
const first=confirm();firstNonce.resolve(1);await balanceStarted.promise;
const second=confirm(); // first nonce completed, first balance pending; confirm still enabled
firstBalance.resolve([]);await submittedFirst.promise;
secondNonce.resolve(2); // API sees newly accepted first transaction
await Promise.all([first,second]);
assert.deepEqual(submits,[1n,2n]);assert.equal(nonceAborts,0);assert.equal(nonceFetches,2);assert.equal(balanceFetches,2);
offNonce();offBalances();client.clear();
console.log('PASS with actual TanStack QueryObserver and cryptoj: two signed payments, nonce 1 and nonce 2; 2 nonce fetches, 2 balance fetches, zero nonce cancellations.');
