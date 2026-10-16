'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const DEFAULT_APPEARANCE = Object.freeze({theme:'vinyl',palette:'terracotta'});
function validAppearance(value) {
  return value && ['vinyl','cassette','cd','reel','mp3','radio'].includes(value.theme) && ['terracotta','forest','ocean','plum'].includes(value.palette)
    ? {theme:value.theme,palette:value.palette} : null;
}
function createAppearanceStore(file) {
  return {
    load() {
      try {return validAppearance(JSON.parse(fs.readFileSync(file,'utf8'))) || {...DEFAULT_APPEARANCE};}
      catch (_) {return {...DEFAULT_APPEARANCE};}
    },
    async save(value) {
      const data=validAppearance(value);if(!data)throw new Error('Ambiance invalide.');
      await fs.promises.mkdir(path.dirname(file),{recursive:true});
      const temporary=file+'.'+randomUUID()+'.tmp';
      try {await fs.promises.writeFile(temporary,JSON.stringify(data,null,2)+'\n','utf8');await fs.promises.rename(temporary,file);}
      finally {await fs.promises.unlink(temporary).catch(()=>{});}
    },
  };
}
module.exports={DEFAULT_APPEARANCE,validAppearance,createAppearanceStore};
