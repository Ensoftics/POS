import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { z } from 'zod';

/** This device's receipt printer. Kept on the device: each till has its own printer. */
export const savedPrinterSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  serviceUUID: z.string().min(1),
  characteristicUUID: z.string().min(1),
  /** Some printers only accept acknowledged writes. */
  withResponse: z.boolean(),
  paperWidth: z.union([z.literal(58), z.literal(80)]),
  autoPrint: z.boolean(),
});
export type SavedPrinter = z.infer<typeof savedPrinterSchema>;

const KEY = 'pos.printer.v1';
const listeners = new Set<(printer: SavedPrinter | null) => void>();

export async function loadPrinter(): Promise<SavedPrinter | null> {
  const raw = await SecureStore.getItemAsync(KEY).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = savedPrinterSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function savePrinter(printer: SavedPrinter | null): Promise<void> {
  if (printer) await SecureStore.setItemAsync(KEY, JSON.stringify(printer));
  else await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
  for (const listener of listeners) listener(printer);
}

/** The saved printer; `undefined` while loading. */
export function useSavedPrinter(): SavedPrinter | null | undefined {
  const [printer, setPrinter] = useState<SavedPrinter | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void loadPrinter().then((value) => {
      if (active) setPrinter(value);
    });
    listeners.add(setPrinter);
    return () => {
      active = false;
      listeners.delete(setPrinter);
    };
  }, []);
  return printer;
}
