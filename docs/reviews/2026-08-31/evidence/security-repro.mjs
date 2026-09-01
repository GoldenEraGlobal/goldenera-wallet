import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire('/tmp/goldenera-wallet-review/frontend/packages/core/package.json');
const { create }=require('zustand');
const { subscribeWithSelector }=require('zustand/middleware');
const base='/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/';
function load(file,exports,context={}) {
  const input=fs.readFileSync(base+file,'utf8').replace(/^import .*\n/gm,'').replace(/\bexport /g,'');
  const code=stripTypeScriptTypes(input,{mode:'transform'});
  return vm.runInNewContext(`${code}\n;({${exports}})`,{console:{log(){},error(){},warn(){}},window:{crypto:webcrypto},Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,...context});
}
const {CryptoUtil,bufferToHex,hexToBuffer}=load('utils/CryptoUtil.ts','CryptoUtil,bufferToHex,hexToBuffer');
const map=new Map();
const basic={getItem:async k=>map.get(k)??null,setItem:async(k,v)=>{map.set(k,v)},removeItem:async k=>{map.delete(k)},clear:async()=>map.clear()};
const credentialId=webcrypto.getRandomValues(new Uint8Array(32));
let webauthnCalls=0;
const {BiometricService}=load('services/BiometricService.ts','BiometricService',{
  BiometricUtil:{getPlatform:()=> 'web',isWebAuthnAvailable:()=>true},StorageService:{basic},bufferToHex,hexToBuffer,
  navigator:{credentials:{create:async()=>{webauthnCalls++;return {rawId:credentialId.buffer}},get:async()=>{throw Error('authentication must not be called')}}},
  window:{crypto:webcrypto,location:{hostname:'review.invalid'}}
});
const password=bufferToHex(webcrypto.getRandomValues(new Uint8Array(16)));
assert.equal(await BiometricService.enable(password),true);
const copiedId=hexToBuffer(map.get('biometric_credential_id'));
const ciphertext=map.get('biometric_encrypted_password');
const key=await BiometricService.deriveKeyFromCredential(copiedId.buffer);
const recovered=new TextDecoder().decode(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:hexToBuffer(ciphertext.iv)},key,hexToBuffer(ciphertext.data)));
assert.equal(recovered,password);
assert.equal(webauthnCalls,1);
console.log('PASS: recovered synthetic wallet password from persisted data only; zero authentication calls');

let keyError=false,removeError=false;
const vault=new Map([['ge_secure:mnemonic','SYNTHETIC_OLD_WALLET']]);
const SecureStoragePlugin={keys:async()=>{if(keyError)throw Error('temporary read error');return {value:[...vault.keys()]}},get:async({key})=>({value:vault.get(key)}),set:async({key,value})=>{vault.set(key,value)},remove:async({key})=>{if(removeError)throw Error('temporary remove error');vault.delete(key)}};
const Preferences={get:async({key})=>({value:map.get(key)??null}),set:async({key,value})=>{map.set(key,value)},remove:async({key})=>map.delete(key),keys:async()=>({keys:[...map.keys()]})};
const {StorageService}=load('services/StorageService.ts','StorageService',{SecureStoragePlugin,Preferences,CryptoUtil});
let generation=0;
const WalletUtil={generateWallet:()=>{generation++;return {mnemonic:'synthetic-phrase-'+generation,address:'synthetic-address-'+generation,privateKey:{generation}}},restoreFromMnemonic:mnemonic=>({mnemonic,address:'address-of-'+mnemonic,privateKey:{mnemonic}}),isValidMnemonic:()=>true};
function makeStore(register=async()=>{}){
  return load('store/WalletStore.ts','useWalletStore',{create,subscribeWithSelector,BiometricService:{isAvailable:async()=>false,getType:async()=> 'none',disable:async()=>{},isEnabled:async()=>false},DeviceService:{getInstance:()=>({register})},WalletUtil,getStorage:()=>StorageService.secure,getBasicStorage:()=>basic,STORAGE_MNEMONIC_KEY:'mnemonic',STORAGE_PHRASE_BACKEDUP_KEY:'backedup'}).useWalletStore;
}
keyError=true;
const brokenRead=makeStore();await brokenRead.getState().initialize();assert.equal(brokenRead.getState().status,'no_wallet');
keyError=false;await brokenRead.getState().createWallet('synthetic-password',false);assert.notEqual(vault.get('ge_secure:mnemonic'),'SYNTHETIC_OLD_WALLET');
console.log('PASS: transient vault key enumeration failure exposes onboarding, then create overwrites existing wallet');
removeError=true;await brokenRead.getState().resetWallet();assert.equal(brokenRead.getState().status,'no_wallet');assert.equal(vault.has('ge_secure:mnemonic'),true);
console.log('PASS: vault delete failure is swallowed and reset reports no_wallet with old mnemonic still stored');
removeError=false;
const sidepanel=makeStore();const popup=makeStore();
await sidepanel.getState().importWallet('synthetic-wallet-A','synthetic-password-A',false);
await popup.getState().resetWallet();await popup.getState().importWallet('synthetic-wallet-B','synthetic-password-B',false);
assert.equal(sidepanel.getState().address,'address-of-synthetic-wallet-A');
assert.equal(await sidepanel.getState().checkPassword('synthetic-password-B'),'synthetic-wallet-B');
assert.equal(sidepanel.getState().getPrivateKey().mnemonic,'synthetic-wallet-A');
console.log('PASS: second context can replace vault while first context signs wallet A and reveals recovery phrase of wallet B');
const gates=[];
const racing=makeStore(()=>new Promise(resolve=>gates.push(resolve)));
const first=racing.getState().unlockWallet('synthetic-wallet-A');
const second=racing.getState().unlockWallet('synthetic-wallet-A');
gates[0]();await first;racing.getState().lockWallet();assert.equal(racing.getState().status,'locked');
gates[1]();await second;assert.equal(racing.getState().status,'unlocked');
console.log('PASS: pending duplicate authentication resurrects private key after explicit lock');
let clock=0,timerId=0,lockCount=0;
const timers=new Map(),listeners=new Map();
const hookSource=fs.readFileSync(base+'router/stackflow.tsx','utf8').split('const useAutoLock =')[1].split('// Component that manages a single stack')[0];
const hookCode=stripTypeScriptTypes('const useAutoLock ='+hookSource,{mode:'transform'});
const documentStub={visibilityState:'visible',addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:()=>{}};
vm.runInNewContext(hookCode+'\nuseAutoLock(true)',{
  AUTO_LOCK_TIMEOUT:120000,useWalletStore:selector=>selector({lockWallet:()=>lockCount++}),useEffect:fn=>fn(),console,
  setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,due:clock+ms});return id},clearTimeout:id=>timers.delete(id),
  window:{addEventListener:()=>{},removeEventListener:()=>{}},document:documentStub
});
clock=600000; // native webview JS timers suspended for ten minutes
listeners.get('visibilitychange')(); // resume dispatch before expired timer callback
for(const [id,timer] of timers){if(timer.due<=clock){timers.delete(id);timer.fn()}}
assert.equal(lockCount,0);assert.equal([...timers.values()][0].due,720000);
console.log('PASS: suspend/resume cancels expired auto-lock and grants another two unlocked minutes');

let signalRegistrationEntered;
const registrationEntered=new Promise(resolve=>{signalRegistrationEntered=resolve});
const blocked=makeStore(()=>{signalRegistrationEntered();return new Promise(()=>{})});
await blocked.getState().resetWallet();
void blocked.getState().createWallet('synthetic-password',false);
await registrationEntered;
assert.equal(blocked.getState().status,'no_wallet');
assert.equal(blocked.getState().getPrivateKey(),null);
assert.equal(vault.has('ge_secure:mnemonic'),true);
console.log('PASS: stalled optional registration prevents local wallet creation from showing the stored recovery phrase');
