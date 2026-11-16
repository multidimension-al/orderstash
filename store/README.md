# Chrome Web Store listing

## Copy and fields

| Field | Value |
| --- | --- |
| Name | OrderStash - Invoice PDFs & Order Export for Amazon |
| Short description | Copy [short-description.txt](short-description.txt). |
| Detailed description | Copy [description.txt](description.txt). |
| Language | English |
| Global promo video | Leave blank. |
| Official URL | Leave blank until an owned website is verified in Search Console. |
| Homepage URL | https://github.com/multidimension-al/orderstash |
| Support URL | https://github.com/multidimension-al/orderstash/issues |
| Privacy policy URL | https://github.com/multidimension-al/orderstash/blob/main/PRIVACY.md |
| Mature content | No |
| Item support | On |
| Visibility | Public when submitting for public distribution. |

The extension has no sign-up flow. The description invites installation and
describes the existing free PDF feature, local library and CSV exports.

## Images to upload

| Field / order | File | Dimensions |
| --- | --- | --- |
| Store icon | [store-icon-128.png](assets/store-icon-128.png) | 128 × 128 |
| Screenshot 1 | [screenshot-1-invoice-pdfs.png](assets/screenshot-1-invoice-pdfs.png) | 1280 × 800 |
| Screenshot 2 | [screenshot-2-saved-orders.png](assets/screenshot-2-saved-orders.png) | 1280 × 800 |
| Screenshot 3 | [screenshot-3-export-status.png](assets/screenshot-3-export-status.png) | 1280 × 800 |
| Screenshot 4 | [screenshot-4-history.png](assets/screenshot-4-history.png) | 1280 × 800 |
| Screenshot 5 | [screenshot-5-local-records.png](assets/screenshot-5-local-records.png) | 1280 × 800 |
| Small promo tile | [promo-small-440x280.png](assets/promo-small-440x280.png) | 440 × 280 |
| Marquee promo tile | [promo-marquee-1400x560.png](assets/promo-marquee-1400x560.png) | 1400 × 560 |

The screenshots and promo tiles are full-size 24-bit RGB PNGs with no alpha
channel. The existing extension icon is a transparent PNG. A separate
[logo](assets/orderstash-logo.png) is included for general branding; use the
128 × 128 icon in the store's icon field.

Screenshots show the actual extension interface using synthetic sample records
in an isolated browser profile. No customer account pages or private records are
included. Receipt and History states are fixture data illustrating existing UI.

## Download or regenerate

Run [Build Chrome Web Store ZIP](https://github.com/multidimension-al/orderstash/actions/workflows/package.yml)
manually. Download `store-listing-assets.zip` from the successful run and extract
it for the images and copy. `OrderStash-0.1.0.zip` is the separate extension upload.

To regenerate the artwork, set `ORDERSTASH_CHROME` and `ORDERSTASH_DRIVER` as
described in [Development](https://github.com/multidimension-al/orderstash/blob/main/docs/DEVELOPMENT.md),
build the extension, then run `npm run assets:store`. Local captures and the
isolated profile go under ignored `test-output/`; only the finished assets go
under `store/assets/`.
