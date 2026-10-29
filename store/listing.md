# Store listings

Copy-paste text for the Chrome Web Store, Firefox Add-ons (AMO) and Microsoft Edge Add-ons. Images are in [`images/`](images/) and are rebuilt with `node tools/store-images.mjs`. The package to upload is `dist/view-sim-extension-<version>.zip` from `node tools/package-extension.mjs` (or the GitHub release).

## Shared text

**Name:** view-sim

**Summary** (Chrome allows 132 characters, AMO 250):

> Preview your site on phones, tablets, laptops and large displays side by side, with real browser bars and transparent screenshots.

**Description** (no lists of device or brand names: Chrome rejected that as keyword spam):

> view-sim shows any website on a row of simulated devices — phones, tablets, laptops and large displays — side by side, inside the browser you already use, with your logins, extensions and dev tools.
>
> REAL SCREEN SIZES
> Each device gets the page area that's really left after its status bar and browser bars, so you see exactly how much room your layout has on a phone, not the full screen height.
>
> THE BROWSER AROUND THE PAGE
> Choose the browser interface for each device. view-sim draws that browser's bars and tabs and sends its user agent, so you see what your users see.
>
> FEELS LIKE A PHONE
> Mobile user agents, touch events, drag-to-scroll and hidden scrollbars on phones and tablets. Navigate on one device and the others follow.
>
> TRANSPARENT SCREENSHOTS
> Save a PNG of the device with its frame, the screen with its bars, or only the page, on a transparent background. Ready for docs, slides and store pages.
>
> FOR AI AGENTS
> An optional, open-source MCP server lets AI coding agents open pages on devices and take screenshots. It runs on your computer only.
>
> PRIVATE BY DESIGN
> No accounts, no analytics, no data collection. view-sim asks for access to a site only when you turn it on for that site.
>
> Free and open source (MIT): https://github.com/itelo/view-sim

**Category:** Developer Tools

**Homepage / support URL:** https://github.com/itelo/view-sim (support: https://github.com/itelo/view-sim/issues)

**Privacy policy URL:** https://github.com/itelo/view-sim/blob/main/PRIVACY.md

## Images

| File | Caption (Firefox asks for one per screenshot) |
| --- | --- |
| `images/screenshot-1-devices.png` | Your site on a MacBook, an iPad and an iPhone at the same time, side by side. |
| `images/screenshot-2-browsers.png` | Pick Safari, Chrome or Firefox per device, with that browser's real bars and user agent. |
| `images/screenshot-3-transparent.png` | Save transparent PNG screenshots of the device with its frame, the screen, or just the page. |
| `images/screenshot-4-mcp.png` | An optional MCP server lets AI agents like Claude Code open pages on devices and check the layout. |
| `images/screenshot-5-popup.png` | Turn it on per site from the toolbar. view-sim asks for access only to that site and collects no data. |
| `images/promo-small-440x280.png` | Chrome "Small promo tile" / Edge "Small promotional tile". |
| `images/promo-marquee-1400x560.png` | Chrome "Marquee promo tile" / Edge "Large promotional tile" (optional). |
| `../extension/icons/icon128.png` | Store icon (128×128), if a store asks for one separately. The source is `../extension/icons/logo.svg`. |

## Chrome Web Store

Upload the zip at https://chrome.google.com/webstore/devconsole (one-time $5 developer fee).

**Store listing tab**
- Description, category, language (English): from above.
- Screenshots (1280×800): `images/screenshot-1-devices.png` to `images/screenshot-5-popup.png`.
- Small promo tile (440×280): `images/promo-small-440x280.png`.
- Marquee promo tile (1400×560, optional): `images/promo-marquee-1400x560.png`.
- Icon: the 128×128 icon comes from the zip.

**Privacy tab**

*Single purpose:*
> Preview websites on simulated phone, tablet and desktop screens side by side, and take screenshots of them.

*Permission justifications:*

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's settings: default devices, zoom, and the list of sites the simulator is turned on for. |
| `scripting` | Registers view-sim's own content scripts on the sites the user turns on, which replace the page with the device simulator and emulate each device inside its frame. |
| `declarativeNetRequest` | On sites the user turned on, sets each device frame's mobile user agent and removes the X-Frame-Options and Content-Security-Policy headers from those frames' responses so the site can load inside the device frames. Rules are limited to that site's own subframes. |
| `alarms` | Retries the optional connection to the local MCP server (127.0.0.1) every 30 seconds while the user has the MCP bridge turned on. |
| Host permissions (optional, `<all_urls>`) | Not granted at install. The popup asks for access to one site when the user turns the simulator on for it. The user can grant access to all sites from the settings page, which the browser requires for tab screenshots (captureVisibleTab). |

*Remote code:* No, I am not using remote code.

*Data usage:* tick none of the data types. Then tick all three certifications (no selling or transfer of user data, no use unrelated to the single purpose, no use for creditworthiness or lending).

**Distribution tab:** Public, all regions.

## Firefox Add-ons (AMO)

Submit at https://addons.mozilla.org/developers/addon/submit/ or sign from the command line:

```bash
npx web-ext@8 sign --source-dir extension --channel listed --amo-metadata store/amo-metadata.json --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
```

(API keys: https://addons.mozilla.org/developers/addon/api/key/.)

- **Add-on id:** `view-sim@itelo` (set in the manifest; it cannot change after the first listed version).
- **Summary, description, homepage, support URL, privacy policy:** from above. AMO descriptions support a little Markdown, so the section headings can be made bold.
- **Category:** Web Development.
- **Tags:** responsive design, mobile, screenshot, developer tools, device emulator.
- **License:** MIT License.
- **Screenshots:** the five `images/screenshot-*.png` files.
- **Data collection:** the manifest declares `data_collection_permissions: none`.
- **Source code:** not needed. The extension has no build step and nothing is minified.
- **Notes for reviewers:**
  > No build step: the uploaded files are the source. To try it, open any http(s) site, click the toolbar button and turn on "Show in the simulator"; the add-on asks for access to that site only. The background page connects to ws://127.0.0.1:47820 only when the user enables the MCP bridge on the settings page; it is a local server the user runs themselves (https://www.npmjs.com/package/view-sim-mcp).

## Microsoft Edge Add-ons

Free to register at https://partner.microsoft.com/dashboard/microsoftedge/. Upload the same zip as for Chrome.

- **Description, category (Developer tools), privacy policy, website, support:** from above.
- **Screenshots (1280×800):** the five `images/screenshot-*.png` files.
- **Small promotional tile (440×280):** `images/promo-small-440x280.png`. **Large (1400×560):** `images/promo-marquee-1400x560.png`.
- **Notes for certification:** the reviewer note from the AMO section above.
