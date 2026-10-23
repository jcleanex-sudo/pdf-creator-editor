import {describe,it,expect} from 'vitest'
import {readInvoiceLink,validateInvoice,type Invoice} from './invoice'

const invoice:Invoice={recipient:'Example Transport',branch:'Example Branch',issuer:'Example Issuer',representative:'Representative Example',address:'Example Address',description:'Shipping services',amount:123456,date:'2026-10-10',due:'2026-12-10'}
const hash=(value:unknown)=>'#invoice='+Buffer.from(JSON.stringify(value)).toString('base64url')
describe('invoice links carry only bounded literal document data',()=>{
  it('restores all supplied fields and omits extra properties',()=>{
    expect(readInvoiceLink(hash(invoice))).toEqual(invoice)
    expect(validateInvoice({...invoice,extra:'ignored'})).toEqual(invoice)
    expect(readInvoiceLink(hash({...invoice,recipient:'日本語の請求先'})).recipient).toBe('日本語の請求先')
  })
  it('rejects malformed links, invalid dates, values and excessive text',()=>{
    for(const value of [{...invoice,amount:1.5},{...invoice,amount:-1},{...invoice,amount:Infinity},{...invoice,date:'2026-02-30'},{...invoice,due:'2026-01-01'},{...invoice,address:'a'.repeat(201)},{...invoice,recipient:'bad\ntext'}])expect(()=>readInvoiceLink(hash(value))).toThrow()
    for(const value of ['#invoice=bad','#invoice='+('a'.repeat(12001)),'#invoice=%','other'])expect(()=>readInvoiceLink(value)).toThrow()
  })
})
