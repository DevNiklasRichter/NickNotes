import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'

// Only dependencies directly used by Electron; renderer dependencies are bundled by Vite.
// Order matters: packages the app imports itself claim the top level first, so a different
// version pinned by electron-updater is nested below it (as npm does).
export const DESKTOP_DEPENDENCIES=['semver','yaml','electron-updater']
export function stageDesktopDependencies(root,target){
  const packages=[],installed=new Map()
  function copy(name,from,parentTarget){
    const require=createRequire(path.join(from,'package.json'))
    let metadataPath
    try{metadataPath=require.resolve(name+'/package.json')}catch{
      let directory=path.dirname(require.resolve(name))
      while(!fs.existsSync(path.join(directory,'package.json')))directory=path.dirname(directory)
      metadataPath=path.join(directory,'package.json')
    }
    const source=path.dirname(metadataPath),metadata=JSON.parse(fs.readFileSync(metadataPath,'utf8'))
    if(metadata.name!==name)throw new Error('Unexpected package resolution: '+name)
    let destination=path.join(target,'node_modules',name)
    if(installed.has(destination)&&installed.get(destination)!==metadata.version)destination=path.join(parentTarget,'node_modules',name)
    if(installed.has(destination)){
      if(installed.get(destination)!==metadata.version)throw new Error('Conflicting runtime dependency: '+name)
      return
    }
    installed.set(destination,metadata.version)
    fs.cpSync(source,destination,{recursive:true,filter:file=>!/(^|[\\/])(node_modules|test|tests|__tests__|\.github|\.git|coverage|examples?)([\\/]|$)/i.test(path.relative(source,file))})
    packages.push({path:path.relative(target,destination).replaceAll('\\','/'),name,version:metadata.version})
    for(const dependency of Object.keys(metadata.dependencies??{}))copy(dependency,source,destination)
  }
  for(const name of DESKTOP_DEPENDENCIES)copy(name,root,target)
  fs.writeFileSync(path.join(target,'runtime-dependencies.json'),JSON.stringify(packages,null,2)+'\n')
  return Object.fromEntries(DESKTOP_DEPENDENCIES.map(name=>[name,installed.get(path.join(target,'node_modules',name))]))
}
