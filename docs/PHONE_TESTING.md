# Testing on a real phone

PranaMap is built for a 2 GB Android phone in a village with no signal. The automated suite emulates that
(`npm run e2e`: Pixel 7 viewport, airplane mode, 4× CPU throttle), but the microphone, camera, Bluetooth
cuff, speaker and real memory pressure need a real phone. This is how to put the app on one from a laptop.

A phone gives the app its microphone, WebCrypto, service worker (offline) and Web Bluetooth only in a
**secure context**: `https://…` or `http://localhost`. Pick one of the three set-ups below.

## A. USB cable (recommended, full fidelity)

Everything works, including installing the PWA and running offline, because the phone sees `localhost`.

1. On the phone: Settings → About phone → tap *Build number* 7 times → Developer options → enable *USB debugging*.
2. Connect the cable and accept the prompt on the phone. Install [platform-tools](https://developer.android.com/tools/releases/platform-tools) on the laptop.
3. Start the app (`scripts/dev.ps1` or `scripts/dev.sh`, or the backend and `npm run dev` yourself).
4. Forward the port and open it on the phone:
   ```sh
   adb reverse tcp:5173 tcp:5173
   ```
   Then open `http://localhost:5173` in Chrome on the phone.
5. To debug, open `chrome://inspect` on the laptop: you get DevTools for the phone's tab (console, network, Application → IndexedDB / Cache Storage).

To test the production build with the service worker exactly as shipped: `npm run build && npx vite preview --port 5173`, same `adb reverse`.

## B. Same Wi-Fi, no cable

```sh
cd frontend
npm run dev:phone        # dev server
npm run preview:phone    # production build (service worker, lazy chunks)
```

Vite prints a `Network: https://192.168.x.x:5173` address. Open it on the phone, accept the certificate
warning (*Advanced → Proceed*: the certificate is self-signed for this laptop).

- Microphone, camera, WebCrypto and Bluetooth work.
- **Offline mode may not:** Chrome refuses to register a service worker on an untrusted certificate. Use set-up A
  to test airplane mode and installation.
- Windows asks once to allow Node.js through the firewall: allow it on *Private* networks.
- The backend stays on the laptop: the phone reaches it through Vite's `/api` proxy, so it does not need to listen on the LAN.

## C. Anywhere (tunnel)

For a reviewer on another network, a tunnel gives a real HTTPS certificate, so everything works:

```sh
cloudflared tunnel --url http://localhost:5173
```

Only use the synthetic demo data over a tunnel: the link is reachable by anyone who has it.

## What to check on the phone

| Area | Check | Expected |
| --- | --- | --- |
| Install | Chrome menu → *Add to home screen*; open from the icon | Opens full screen, no browser bar |
| Offline | Sign in, wait for *Synced*, airplane mode on, screen someone | Whole screening works; header says *Offline · N changes safe on this phone* |
| Sync | Airplane mode off | Counter drops to 0; the MO sees the referral on `/phc` |
| Lock | Close the app, reopen | PIN screen; data opens only with the PIN |
| Voice, offline | Settings (gear) → download Hindi or Bengali → airplane mode → *Tap and speak* on a BP step, say "एक सौ पचास बटा नब्बे" | Shows 150 / 90 for confirmation within a few seconds |
| Voice prompts | Unmute the speaker icon | Each question is read aloud in the chosen language |
| Camera | On a BP or glucose step, *Photo of display* → photograph a monitor → drag a box round the digits | The numbers are read and offered for confirmation |
| Bluetooth | *Bluetooth device* with a BLE cuff (Omron, A&D, Beurer…) or pulse oximeter | Reading fills in after the measurement ends |
| Emergency | Tick *Chest pain* | Full-screen alert with *Call 108* (opens the dialler) and SMS to the ANM |
| Low-end | Use the cheapest phone available | Each answer moves to the next question without visible delay |
| Accessibility | TalkBack on | Buttons and steps are announced; the keypad is usable |
| Languages | Switch to বাংলা / हिन्दी in the header | Every screen translated; numbers and units correct |

Record the phone model, Android and Chrome versions, and anything that failed, in the issue tracker.
