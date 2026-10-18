# ADR 0019 — Bluetooth receipt printers on Android

- **Status:** Accepted (2026-10-18)

## Context

Android tills need to print receipts on the small thermal printers Sri Lankan shops use: 58 mm
or 80 mm, battery-powered, Bluetooth. Receipts carry product names and labels in Sinhala and
Tamil, which the printers' built-in fonts (Latin code pages) cannot print. Printing must keep
working without an internet connection.

## Decision

- **Transport: Bluetooth Low Energy** through `react-native-ble-plx`, which is maintained and
  ships an Expo config plugin.
  - The plugin declares `BLUETOOTH_SCAN` (with `neverForLocation`) and `BLUETOOTH_CONNECT`;
    location permission is requested only on Android 11 and older, where Bluetooth scans
    need it.
  - The app asks for these permissions at the moment of use.
  - Printers that pair only over classic Bluetooth (SPP) are not supported; most current
    models are dual-mode and also offer BLE.
- **Printer setup** is per device (each till has its own printer), stored with the device's
  secure storage. On the **Receipt printer** screen staff:
  - find nearby named devices (12-second scan) and choose one;
  - set the paper width (58 / 80 mm) and automatic printing;
  - print a test page or forget the printer.
- **Finding where print data goes:** on choosing a printer, the app connects once and picks
  a writable characteristic, preferring the services common printers use (`18F0`, the
  Microchip/ISSC and Xprinter ones). It remembers whether the printer needs acknowledged
  writes.
- **Printing as an image:**
  - the receipt is drawn as a plain black-on-white view off screen and captured
    (`react-native-view-shot`, PNG) at the paper's width (384 or 576 dots at 203 dpi);
  - it is decoded (`fast-png`, pure JS) and converted to black and white;
  - it is sent as ESC/POS raster data (`GS v 0` in bands of at most 255 rows), followed by
    a feed and a partial cut, which printers without a cutter ignore.
  - So Sinhala, Tamil and any font the phone can show print correctly, and the receipt
    looks the same on every printer model.
- **Sending:**
  - data goes in pieces sized to the negotiated MTU (requested 185);
  - unacknowledged writes are paced a few milliseconds apart so the printer's small buffer
    keeps up;
  - the app disconnects after each job, so the printer is free for another device.
- **Offline:** printing needs no network. Receipts of sales saved offline print the same
  way, with a "pending" number.
- **Errors** are shown in plain words: Bluetooth off, permission refused, printer not
  reachable, not a printer, printing stopped part way.
- **Code layout:** the encoder (`escpos.ts`), the PNG decoding and the test page are pure
  and unit-tested. The Bluetooth layer is tested against a fake BLE manager.

## Consequences

- Raster jobs are larger than text: about 10–40 KB per receipt, a few seconds over BLE.
  This is acceptable at a till, and the price of correct local scripts.
- Real-printer behaviour (pacing, MTU, characteristic choice) cannot be proven by automated
  tests. It must be checked on the models a shop uses before a pilot (Slice 14).
- Cash drawers driven by the printer's kick-out port, and web (browser) printing to
  Bluetooth printers, are not included. The web app keeps using the browser's print dialog.
