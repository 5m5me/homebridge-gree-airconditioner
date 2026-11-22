# Cloud control for the Gym unit (stage 2)

Date: 2026-11-22
Base: 5m5me fork, branch dry-switch (2.3.3-dry.1)
Owner: Ned

## Problem

The Gym unit (MAC 580d0d872e16, 192.168.55.119) answers ping but not the local
Gree protocol on UDP 7000. Its Wi-Fi module is cloud-only, so the plugin
cannot bind to it. It works in the Gree+ app.

## Goal

Control the Gym unit from Apple Home through Gree's cloud, with the same tile
and Dry switch as the four local units. The four local units stay on the local
protocol.

## Decisions made by Ned

- Cloud path chosen over swapping the Wi-Fi module.
- A second Gree+ account, used only by Homebridge, will hold the credentials.
  Ned creates it and shares the Gym unit with it.
- Credentials are typed into the Homebridge settings by Ned. They are stored in
  plain text in the Homebridge config.

## Reference

Protocol taken from the MIT-licensed greeclimate-davo22 library (used by
davo22/homeassistant-gree-cloud): signed and AES-encrypted HTTPS calls to the
regional server for sign-in and device list, then MQTT over TLS (port 1984) to
the regional broker for status and commands. Older modules (protocol below
3.2) use a per-device TLS gateway instead of MQTT. Australia: REST
https://augrih.gree.com, broker mqtt-au.gree.com.

## Phases

### Phase A: sign-in, device list and probe (this plan)

- Cloud API client: sign in, list homes, list devices.
- Platform-level `cloud` settings: `username`, `password`, `region`
  (default "Australia").
- A probe command run on the Homebridge server that signs in and prints each
  device's name, MAC, model, module version, online flag and parent MAC. It
  never prints the device key, the token or the password.
- Purpose: prove the account can see the Gym unit and learn its module version,
  which decides the transport for phase B.

### Phase B: transport and accessory (separate plan, after the probe result)

- MQTT transport (or the TLS gateway, if the probe shows an older module).
- A transport interface in the accessory so a cloud device reuses the existing
  status and command handling, including the Dry switch.
- Platform creates the Gym accessory from the cloud device list.
- Status polling, reconnect and sign-in renewal.

## Risks

- Gree may allow one session per account. The second account avoids logging
  the phone app out.
- Unofficial interface: Gree can change it without notice.
- Cloud status is slower than local and needs internet.
- Phase B cannot be finalised until the probe has run against the real
  account.

## Testing

- Unit tests for the signing, password hashing and encryption against vectors
  computed with the reference implementation, and for response parsing with a
  fake HTTP layer.
- Live: the probe, run by hand on the Homebridge server.
