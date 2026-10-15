/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({importSkill:vi.fn()}))
vi.mock('@/api/client',()=>({runtimeApi:mocks}))
vi.mock('@tanstack/react-router',()=>({Link:({children}:{children:React.ReactNode})=>children}))
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}))
import { ImportToRuntimeButton } from './import-to-runtime-button'
afterEach(()=>{cleanup();mocks.importSkill.mockReset()})
describe('ImportToRuntimeButton',()=>{
 it('imports the selected immutable coordinate before linking to bundle composition',async()=>{
  mocks.importSkill.mockResolvedValue({contentId:'registry-fixed',revision:1,digest:'sha'})
  render(<ImportToRuntimeButton namespace="global" slug="weather" version="1.0.0" />)
  fireEvent.click(screen.getByRole('button',{name:'runtime.import'}))
  await screen.findByText('registry-fixed')
  expect(mocks.importSkill).toHaveBeenCalledWith({namespace:'global',slug:'weather',version:'1.0.0'})
 })
 it('does not report success when the backend rejects the source',async()=>{
  mocks.importSkill.mockRejectedValue(new Error('Published public version required'))
  render(<ImportToRuntimeButton namespace="team" slug="private" version="1.0.0" />)
  fireEvent.click(screen.getByRole('button',{name:'runtime.import'}))
  expect((await screen.findByRole('alert')).textContent).toContain('Published public')
  expect(screen.queryByRole('status')).toBeNull()
 })
})
