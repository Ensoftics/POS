import { fireEvent, render, screen } from '@testing-library/react-native';
import '@/lib/i18n';
import PrinterScreen from '@/app/(app)/printer';
import { fromBase64 } from '@/lib/printing/escpos';
import { loadPrinter } from '@/lib/printing/printer-store';
import { secureStoreMap } from '../test/fixtures';

const ble = jest.requireMock('react-native-ble-plx').__manager;
const PRINTER = 'AA:BB:CC:DD:EE:FF';

function fakePrinter(write = jest.fn(async () => undefined)) {
  const device = {
    mtu: 185,
    discoverAllServicesAndCharacteristics: async () => device,
    services: async () => [
      { uuid: '0000180a-0000-1000-8000-00805f9b34fb' },
      { uuid: '000018f0-0000-1000-8000-00805f9b34fb' },
    ],
    characteristicsForService: async (uuid: string) =>
      uuid.startsWith('000018f0')
        ? [
            {
              uuid: '00002af1-0000-1000-8000-00805f9b34fb',
              isWritableWithoutResponse: true,
              isWritableWithResponse: true,
            },
          ]
        : [{ uuid: '00002a29-0000-1000-8000-00805f9b34fb', isWritableWithoutResponse: false }],
    writeCharacteristicWithoutResponseForService: write,
  };
  ble.connectToDevice.mockResolvedValue(device);
  return write;
}

describe('receipt printer settings', () => {
  beforeEach(() => {
    secureStoreMap().clear();
    jest.clearAllMocks();
    ble.state.mockResolvedValue('PoweredOn');
    ble.startDeviceScan.mockImplementation(
      async (_uuids: unknown, _options: unknown, listener: (e: null, d: unknown) => void) => {
        listener(null, { id: PRINTER, name: 'MTP-II' });
        listener(null, { id: PRINTER, name: 'MTP-II' }); // seen twice, listed once
        listener(null, { id: '11:22', name: null }); // unnamed devices are skipped
      },
    );
  });

  it('finds a printer, saves where its print data goes and prints a test page', async () => {
    const write = fakePrinter();
    await render(<PrinterScreen />);
    expect(await screen.findByText('No printer chosen yet.')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Find printers' }));
    expect(await screen.findAllByRole('button', { name: 'MTP-II' })).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'MTP-II' }));
    expect(await screen.findByText('MTP-II is ready to print.')).toBeOnTheScreen();
    expect(await loadPrinter()).toEqual({
      id: PRINTER,
      name: 'MTP-II',
      serviceUUID: '000018f0-0000-1000-8000-00805f9b34fb',
      characteristicUUID: '00002af1-0000-1000-8000-00805f9b34fb',
      withResponse: false,
      paperWidth: 58,
      autoPrint: false,
    });

    await fireEvent.press(screen.getByRole('radio', { name: '80 mm' }));
    await fireEvent(
      screen.getByLabelText('Print every receipt automatically'),
      'valueChange',
      true,
    );
    expect(await loadPrinter()).toMatchObject({ paperWidth: 80, autoPrint: true });

    await fireEvent.press(screen.getByRole('button', { name: 'Print a test page' }));
    expect(await screen.findByText(/Test page sent/)).toBeOnTheScreen();
    const sent = write.mock.calls.flatMap((call) =>
      Array.from(fromBase64((call as unknown as string[])[2]!)),
    );
    // 80 mm paper: raster rows 72 bytes wide.
    expect(sent.slice(0, 8)).toEqual([0x1b, 0x40, 0x1d, 0x76, 0x30, 0, 72, 0]);

    await fireEvent.press(screen.getByRole('button', { name: 'Forget this printer' }));
    expect(await screen.findByText('No printer chosen yet.')).toBeOnTheScreen();
    expect(await loadPrinter()).toBeNull();
  });

  it('says when Bluetooth is off', async () => {
    ble.state.mockResolvedValue('PoweredOff');
    await render(<PrinterScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Find printers' }));
    expect(
      await screen.findByText('Bluetooth is off. Switch it on and try again.'),
    ).toBeOnTheScreen();
    expect(ble.startDeviceScan).not.toHaveBeenCalled();
  });
});
