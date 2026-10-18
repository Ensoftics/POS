import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, type Characteristic, State } from 'react-native-ble-plx';
import { chunk, toBase64 } from './escpos';
import type { SavedPrinter } from './printer-store';

/** Why printing could not happen; each has a message under `printing.errors`. */
export type PrinterProblem =
  'bluetooth_off' | 'permission_denied' | 'not_reachable' | 'not_a_printer' | 'send_failed';

export class PrinterError extends Error {
  constructor(readonly problem: PrinterProblem) {
    super(`printer: ${problem}`);
  }
}

export interface FoundPrinter {
  id: string;
  name: string;
}

export type PrinterLink = Pick<SavedPrinter, 'serviceUUID' | 'characteristicUUID' | 'withResponse'>;

// Services that common Bluetooth receipt printers use for their print data.
const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
];
const SCAN_MS = 12_000;
const MTU = 185;

let manager: BleManager | null = null;
const ble = () => (manager ??= new BleManager());

/** Android 12+ asks for "Nearby devices"; older versions need location for Bluetooth scans. */
async function ensurePermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const wanted =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  if (!wanted.every((permission) => result[permission] === PermissionsAndroid.RESULTS.GRANTED))
    throw new PrinterError('permission_denied');
}

async function ensureReady(): Promise<void> {
  await ensurePermissions();
  if ((await ble().state()) !== State.PoweredOn) throw new PrinterError('bluetooth_off');
}

/**
 * Lists nearby Bluetooth (BLE) devices with a name, for 12 seconds or until
 * stopped. Returns a function that stops the scan.
 */
export async function scanForPrinters(
  onFound: (printer: FoundPrinter) => void,
  onDone: (problem?: PrinterProblem) => void,
): Promise<() => void> {
  await ensureReady();
  const seen = new Set<string>();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    void ble().stopDeviceScan();
    onDone();
  };
  const timer = setTimeout(stop, SCAN_MS);
  await ble().startDeviceScan(null, null, (error, device) => {
    if (error) {
      stopped = true;
      clearTimeout(timer);
      onDone('not_reachable');
      return;
    }
    const name = device?.name ?? device?.localName;
    if (!device || !name || seen.has(device.id)) return;
    seen.add(device.id);
    onFound({ id: device.id, name });
  });
  return stop;
}

/** Connects once to find where print data goes: a writable characteristic, printer services first. */
export async function findPrinterLink(deviceId: string): Promise<PrinterLink> {
  await ensureReady();
  const device = await connect(deviceId);
  try {
    const services = await device.services();
    const ordered = [...services].sort((a, b) => rank(a.uuid) - rank(b.uuid));
    for (const service of ordered) {
      const characteristics: Characteristic[] = await device.characteristicsForService(
        service.uuid,
      );
      const writable = characteristics.find(
        (c) => c.isWritableWithoutResponse || c.isWritableWithResponse,
      );
      if (writable)
        return {
          serviceUUID: service.uuid,
          characteristicUUID: writable.uuid,
          withResponse: !writable.isWritableWithoutResponse,
        };
    }
    throw new PrinterError('not_a_printer');
  } finally {
    await ble()
      .cancelDeviceConnection(deviceId)
      .catch(() => undefined);
  }
}

/** Sends a print job, then disconnects so other devices can use the printer. */
export async function sendToPrinter(printer: SavedPrinter, job: Uint8Array): Promise<void> {
  await ensureReady();
  const device = await connect(printer.id);
  try {
    // Room per write is the MTU minus 3 bytes of protocol overhead.
    const size = Math.max(20, Math.min(device.mtu, MTU) - 3);
    for (const piece of chunk(job, size)) {
      const value = toBase64(piece);
      if (printer.withResponse)
        await device.writeCharacteristicWithResponseForService(
          printer.serviceUUID,
          printer.characteristicUUID,
          value,
        );
      else {
        await device.writeCharacteristicWithoutResponseForService(
          printer.serviceUUID,
          printer.characteristicUUID,
          value,
        );
        // Unacknowledged writes can outrun the printer's small buffer.
        await new Promise((resolve) => setTimeout(resolve, 8));
      }
    }
  } catch (error) {
    if (error instanceof PrinterError) throw error;
    throw new PrinterError('send_failed');
  } finally {
    await ble()
      .cancelDeviceConnection(printer.id)
      .catch(() => undefined);
  }
}

async function connect(deviceId: string) {
  try {
    const device = await ble().connectToDevice(deviceId, { requestMTU: MTU, timeout: 10_000 });
    return await device.discoverAllServicesAndCharacteristics();
  } catch {
    throw new PrinterError('not_reachable');
  }
}

function rank(uuid: string): number {
  const index = PRINTER_SERVICES.indexOf(uuid.toLowerCase());
  return index === -1 ? PRINTER_SERVICES.length : index;
}
