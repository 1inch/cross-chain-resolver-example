"use client"
import { useEffect, useState, startTransition } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Form, FormDescription, FormItem, FormLabel, FormMessage } from '@/components/ui/Form'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { submitIntentOnNear } from '@/services/near-server'

const Schema = z.object({
  maker_near: z.string().min(2, 'Required'),
  taker_near: z.string().min(2, 'Required'),
  maker_asset_near: z.string().min(2, 'Required'),
  taker_asset_evm: z.string().regex(/^0x[0-9a-fA-F]{40}$/g, '0x + 20 bytes hex'),
  making_amount: z.string().regex(/^\d+$/, 'Numeric string'),
  taking_amount: z.string().regex(/^\d+$/, 'Numeric string'),
  order_hash_hex: z.string().regex(/^0x[0-9a-fA-F]{64}$/g, '0x + 32 bytes hex'),
  dst_chain_id: z.coerce.number().int().positive(),
  timelocks_hex: z.string().regex(/^0x[0-9a-fA-F]*$/g, '0x + hex').default('0x'),
  extra_json: z
    .string()
    .optional()
    .transform((v) => v || '')
    .refine((v) => {
      if (!v) return true
      try { JSON.parse(v); return true } catch { return false }
    }, 'Invalid JSON')
})

type FormValues = z.infer<typeof Schema>

export default function Page() {
  const [result, setResult] = useState<string>('')
  const { toast } = useToast()
  const { register, handleSubmit, formState: { errors, isSubmitting }, watch, setValue } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      maker_near: process.env.NEXT_PUBLIC_NEAR_ACCOUNT_ID || 'fusionswap.testnet',
      taker_near: process.env.NEXT_PUBLIC_NEAR_ACCOUNT_ID || 'fusionswap.testnet',
      maker_asset_near: 'wrap.testnet',
      taker_asset_evm: '0xdd13e55209fd76afe204dbda4007c227904f0a81',
      making_amount: '2000000000000000000',
      taking_amount: '2000000000000000000',
      order_hash_hex: '0x000000000000000000000000000000000000000000000000000000000000abcd',
      dst_chain_id: 11155111,
      timelocks_hex: '0x'
    }
  })

  useEffect(() => {
    // Prefill token from .env via API if present and well-formed
    fetch('/api/env', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j?.TOKEN_HEX20 && /^0x[0-9a-fA-F]{40}$/.test(j.TOKEN_HEX20)) {
          setValue('taker_asset_evm', j.TOKEN_HEX20)
        }
      })
      .catch(() => {})
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSubmit = (data: FormValues) => {
    const { extra_json, ...rest } = data
    let intent: Record<string, unknown> = { ...rest }
    if (extra_json) {
      try {
        intent = { ...intent, ...JSON.parse(extra_json) }
      } catch {
        // Should be caught by validation, but double-guard
      }
    }
    startTransition(async () => {
      try {
        const res = await submitIntentOnNear({ intent })
        setResult(`Submitted. tx=${res.tx} status=${JSON.stringify(res.status)}`)
        toast({ variant: 'success', title: 'Intent submitted', description: `tx=${res.tx}` })
      } catch (e) {
        const msg = (e as Error).message
        setResult(`Error: ${msg}`)
        toast({ variant: 'error', title: 'Submission failed', description: msg })
      }
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Compose Swap</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={handleSubmit(onSubmit)}>
            <FormItem>
              <FormLabel htmlFor="maker_near">Maker (NEAR)</FormLabel>
              <Input id="maker_near" {...register('maker_near')} />
              <FormDescription>NEAR account ID of the maker (payer on NEAR).</FormDescription>
              <FormMessage>{errors.maker_near?.message}</FormMessage>
            </FormItem>
            <FormItem>
              <FormLabel htmlFor="taker_near">Taker (NEAR)</FormLabel>
              <Input id="taker_near" {...register('taker_near')} />
              <FormDescription>NEAR account ID of the taker (receiver on NEAR).</FormDescription>
              <FormMessage>{errors.taker_near?.message}</FormMessage>
            </FormItem>
            <FormItem>
              <FormLabel htmlFor="maker_asset_near">Maker Asset (NEP-141)</FormLabel>
              <Input id="maker_asset_near" {...register('maker_asset_near')} />
              <FormDescription>Token account (e.g., wrap.testnet).</FormDescription>
              <FormMessage>{errors.maker_asset_near?.message}</FormMessage>
            </FormItem>
            <FormItem>
              <FormLabel htmlFor="taker_asset_evm">Taker Asset (EVM 0x20)</FormLabel>
              <Input id="taker_asset_evm" {...register('taker_asset_evm')} />
              <FormDescription>
                ERC-20 address on the destination EVM chain. {/^0x[0-9a-fA-F]{40}$/.test(watch('taker_asset_evm') || '') ? (
                  <span className="text-green-700">Format OK</span>
                ) : (
                  <span className="text-red-700">Invalid</span>
                )}
              </FormDescription>
              <FormMessage>{errors.taker_asset_evm?.message}</FormMessage>
            </FormItem>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="making_amount">Making Amount</FormLabel>
                <Input id="making_amount" {...register('making_amount')} />
                <FormDescription>Amount on NEAR (as a numeric string, e.g., yocto).</FormDescription>
                <FormMessage>{errors.making_amount?.message}</FormMessage>
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="taking_amount">Taking Amount</FormLabel>
                <Input id="taking_amount" {...register('taking_amount')} />
                <FormDescription>Desired amount on EVM (numeric string).</FormDescription>
                <FormMessage>{errors.taking_amount?.message}</FormMessage>
              </FormItem>
            </div>
            <FormItem>
              <FormLabel htmlFor="order_hash_hex">Order Hash (0x32)</FormLabel>
              <Input id="order_hash_hex" {...register('order_hash_hex')} />
              <FormDescription>
                Unique order identifier (32-byte hex). {/^0x[0-9a-fA-F]{64}$/.test(watch('order_hash_hex') || '') ? (
                  <span className="text-green-700">Format OK</span>
                ) : (
                  <span className="text-red-700">Invalid</span>
                )}
              </FormDescription>
              <FormMessage>{errors.order_hash_hex?.message}</FormMessage>
            </FormItem>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="dst_chain_id">Destination Chain ID</FormLabel>
                <Input id="dst_chain_id" type="number" {...register('dst_chain_id', { valueAsNumber: true })} />
                <FormDescription>EVM chain id (e.g., 11155111 for Sepolia).</FormDescription>
                <FormMessage>{errors.dst_chain_id?.message}</FormMessage>
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="timelocks_hex">Timelocks (hex)</FormLabel>
                <Input id="timelocks_hex" {...register('timelocks_hex')} />
                <FormDescription>Optional; leave 0x to use defaults on NEAR listener.</FormDescription>
                <FormMessage>{errors.timelocks_hex?.message}</FormMessage>
              </FormItem>
            </div>
            <FormItem>
              <FormLabel htmlFor="extra_json">Extra JSON (optional)</FormLabel>
              <Textarea id="extra_json" rows={6} placeholder="{}" {...register('extra_json')} />
              <FormDescription>Merge additional fields into the intent payload.</FormDescription>
              <FormMessage>{errors.extra_json?.message}</FormMessage>
            </FormItem>
            <Button type="submit" disabled={isSubmitting}>Submit Intent</Button>
          </Form>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Submission Result</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="rounded-md bg-gray-100 p-3 text-xs whitespace-pre-wrap break-words">{result}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
