import {expect,test,vi} from 'vitest'
import {createCommandRunner} from './useAppCommands'
import {beginSessionSwitch} from './apiClient'
import {COMMANDS,type AppCommand,type CommandId} from './commands'

function command(id:CommandId,run:()=>unknown,enabled=true):AppCommand {
  return {...COMMANDS.find(item=>item.id===id)!,enabled,run}
}
function deferred(){
  let resolve!:()=>void
  const promise=new Promise<void>(done=>resolve=done)
  return {promise,resolve}
}

test('save requests wait in order and retain the requested document target',async()=>{
  const gate=deferred(),errors=vi.fn(),runner=createCommandRunner(errors),calls:string[]=[]
  const first=runner.execute(command('save',async()=>{calls.push('A:first');await gate.promise}))
  await Promise.resolve()
  const second=runner.execute(command('save',()=>{calls.push('A:second')}))
  const third=runner.execute(command('save',()=>{calls.push('B')}))
  expect(calls).toEqual(['A:first'])
  gate.resolve()
  await Promise.all([first,second,third])
  expect(calls).toEqual(['A:first','A:second','B'])
  expect(errors).not.toHaveBeenCalled()
})

test('save and save-all share the same serialization',async()=>{
  const gate=deferred(),runner=createCommandRunner(vi.fn()),calls:string[]=[]
  const first=runner.execute(command('saveAll',async()=>{calls.push('all:start');await gate.promise;calls.push('all:end')}))
  await Promise.resolve()
  const second=runner.execute(command('save',()=>{calls.push('save')}))
  expect(calls).toEqual(['all:start'])
  gate.resolve()
  await Promise.all([first,second])
  expect(calls).toEqual(['all:start','all:end','save'])
})

test('a failed save reports its error without losing the following explicit save request',async()=>{
  const errors=vi.fn(),runner=createCommandRunner(errors),next=vi.fn()
  const first=runner.execute(command('save',()=>{throw new Error('save failed')}))
  const second=runner.execute(command('save',next))
  await Promise.all([first,second])
  expect(errors).toHaveBeenCalledWith('Error: save failed')
  expect(next).toHaveBeenCalledOnce()
})

test.each(['session','owner'] as const)('queued saves expire after a %s change',async reason=>{
  const gate=deferred(),runner=createCommandRunner(vi.fn()),next=vi.fn()
  const first=runner.execute(command('save',()=>gate.promise))
  await Promise.resolve()
  const second=runner.execute(command('save',next))
  if(reason==='session')beginSessionSwitch();else runner.cancelPending()
  gate.resolve()
  await Promise.all([first,second])
  expect(next).not.toHaveBeenCalled()
  await runner.execute(command('save',next))
  expect(next).toHaveBeenCalledOnce()
})

test('duplicate non-save commands stay guarded and disabled commands do not run',async()=>{
  const gate=deferred(),runner=createCommandRunner(vi.fn()),run=vi.fn(()=>gate.promise)
  const first=runner.execute(command('deleteNote',run))
  await runner.execute(command('deleteNote',run))
  await runner.execute(command('newNote',run,false))
  expect(run).toHaveBeenCalledOnce()
  gate.resolve();await first
  await runner.execute(command('deleteNote',run))
  expect(run).toHaveBeenCalledTimes(2)
})
