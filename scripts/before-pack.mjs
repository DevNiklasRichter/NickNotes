import fs from 'node:fs'
import path from 'node:path'
import {DESKTOP_DEPENDENCIES} from './desktop-dependencies.mjs'
/** Validate the explicit runtime tree; the normal collector packs it without installing/rebuilding. */
export default async function beforePack({packager}) {
 const appDir=packager.info.appDir
 const pkg=JSON.parse(fs.readFileSync(path.join(appDir,'package.json'),'utf8'))
 if(Object.keys(pkg.dependencies??{}).sort().join(',')!==[...DESKTOP_DEPENDENCIES].sort().join(','))throw new Error('Unexpected desktop runtime dependencies')
 for(const name of DESKTOP_DEPENDENCIES)if(!fs.existsSync(path.join(appDir,'node_modules',name,'package.json')))throw new Error('Missing staged runtime dependency: '+name)
}
