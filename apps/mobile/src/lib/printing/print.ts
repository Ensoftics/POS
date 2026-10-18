import type { ComponentRef } from 'react';
import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { sendToPrinter } from './bluetooth';
import { PAPER_DOTS, rasterJob } from './escpos';
import type { SavedPrinter } from './printer-store';
import { decodeReceiptPng } from './receipt-image';

/** A mounted view to print and its laid-out size (layout units). */
export interface PrintableView {
  view: ComponentRef<typeof View>;
  width: number;
  height: number;
}

/**
 * Prints a view exactly as drawn: captured as an image scaled to the paper's
 * width, turned into black and white, and sent as ESC/POS raster data.
 */
export async function printView(printable: PrintableView, printer: SavedPrinter): Promise<void> {
  const width = PAPER_DOTS[printer.paperWidth];
  const height = Math.max(1, Math.round((width * printable.height) / printable.width));
  const base64 = await captureRef(printable.view, {
    format: 'png',
    result: 'base64',
    width,
    height,
  });
  await sendToPrinter(printer, rasterJob(decodeReceiptPng(base64)));
}
