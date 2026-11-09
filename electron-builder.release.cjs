// Only run intentionally on the signing laptop. The normal CI candidate never uses this config.
const path=require('node:path')
const publisher=process.env.NICKNOTES_PUBLISHER_NAME
if(process.env.NICKNOTES_RELEASE_BUILD!=='1'||!publisher)throw new Error('Use npm run package:release with the expected certificate publisher.')
module.exports={
  extends:'./electron-builder.yml',forceCodeSigning:true,
  win:{signExecutable:true,signtoolOptions:{publisherName:publisher,certificateSubjectName:process.env.NICKNOTES_CERTIFICATE_SUBJECT_NAME||undefined,signingHashAlgorithms:['sha256']}},
  // The frozen backend lives outside app.asar.unpacked and is not found by the default signing walk.
  afterPack:async context=>context.packager.signIf(path.join(context.appOutDir,'resources/backend/nicknotes-backend.exe')),
}
