(() => {
  'use strict';
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const random = size => crypto.getRandomValues(new Uint8Array(size));
  const aad = (owner, id, kind) => encoder.encode(JSON.stringify(['freshy-scan-v1', owner, id, kind]));

  async function derive(passphrase, salt) {
    if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 256) throw Error('Invalid passphrase');
    const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', iterations:600000, salt},
      material, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  }
  async function seal(key, bytes, context) {
    const iv = random(12);
    const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:context}, key, bytes);
    return {iv,ciphertext};
  }
  function open(key, packet, context) {
    return crypto.subtle.decrypt({name:'AES-GCM',iv:packet.iv,additionalData:context},key,packet.ciphertext);
  }
  async function create(owner, passphrase) {
    const salt = random(16), key = await derive(passphrase, salt);
    const proof = await seal(key, encoder.encode('verified'), aad(owner,'','check'));
    return {key, config:{owner,salt,proof,v:1}};
  }
  async function unlock(config, passphrase) {
    if (config.v !== 1) throw Error('Unknown vault version');
    const key = await derive(passphrase, config.salt);
    const proof = await open(key, config.proof, aad(config.owner,'','check'));
    if (decoder.decode(proof) !== 'verified') throw Error('Invalid vault');
    return key;
  }
  async function encrypt(key, item) {
    const {id,owner,blob,pdfBlob,...metadata} = item;
    const [meta,image,pdf] = await Promise.all([
      seal(key,encoder.encode(JSON.stringify(metadata)),aad(owner,id,'meta')),
      blob.arrayBuffer().then(bytes => seal(key,bytes,aad(owner,id,'image'))),
      pdfBlob?.arrayBuffer().then(bytes => seal(key,bytes,aad(owner,id,'pdf')))
    ]);
    return {id,owner,meta,image,...(pdf ? {pdf} : {}),v:1};
  }
  async function metadata(key, sealed) {
    if (sealed.v !== 1) throw Error('Unencrypted record');
    const {owner,id} = sealed;
    return {...JSON.parse(decoder.decode(await open(key,sealed.meta,aad(owner,id,'meta')))),id,owner};
  }
  async function image(key, sealed) {
    return new Blob([await open(key,sealed.image,aad(sealed.owner,sealed.id,'image'))],{type:'image/jpeg'});
  }
  async function pdf(key, sealed) {
    if (sealed.v !== 1 || !sealed.pdf) return null;
    return new Blob([await open(key,sealed.pdf,aad(sealed.owner,sealed.id,'pdf'))],{type:'application/pdf'});
  }
  globalThis.FreshyVault = Object.freeze({create,unlock,encrypt,metadata,image,pdf});
})();
