# Bulk Query Test Report

Generated: 2026-09-05T19:40:57.749Z
Mode: live
Input: reports/vahan-comparison-live-2026-09-06.json
JSON report: reports/vahan-comparison-live-retry-2026-09-06.json

## Summary

Completed: 44
Passed: 30
Failed: 14
Refreshed: 34
Refresh failed: 4

## Pass

| # | Label | Query | Status | Rows | Total | Issues |
| - | - | - | - | -: | -: | - |
| 1 | Query 1 | Show vehicle registrations in Maharashtra for January 2025. | live | 1 | 289682 | OK |
| 2 | Query 2 | Show registrations in Delhi from February 2025 to March 2025. | live | 2 | 109830 | OK |
| 3 | Query 9 | Show two wheeler registrations in Bihar during October 2024. | live | 1 | 87817 | OK |
| 4 | Query 10 | Show three wheeler registrations in Kerala during November 2024. | live | 1 | 2470 | OK |
| 5 | Query 11 | Show four wheeler registrations in Telangana during December 2024. | live | 1 | 15714 | OK |
| 6 | Query 12 | Show LMV registrations in Madhya Pradesh during January 2025. | live | 1 | 36296 | OK |
| 7 | Query 13 | Show HMV registrations in Odisha during February 2025. | live | 1 | 2 | OK |
| 8 | Query 14 | Show motor car registrations in Assam during March 2025. | live | 1 | 5942 | OK |
| 9 | Query 15 | Show bus registrations in Jharkhand during April 2025. | live | 1 | 162 | OK |
| 10 | Query 16 | Show goods carrier registrations in Haryana during May 2025. | live | 1 | 4758 | OK |
| 11 | Query 17 | Show passenger e-rickshaw registrations in Punjab during June 2025. | live | 1 | 965 | OK |
| 12 | Query 18 | Show scooter registrations in Andhra Pradesh during July 2025. | live | 1 | 47494 | OK |
| 13 | Query 19 | Show BS VI vehicle registrations in Chandigarh during August 2025. | live | 1 | 3497 | OK |
| 15 | Query 21 | Show BS III motor car registrations in Maharashtra during October 2025. | live | 1 | 1 | OK |
| 16 | Query 23 | Show motor car registrations at MH-12 RTO during January 2025. | live | 1 | 7961 | OK |
| 20 | Query 27 | Show BS VI registrations at UP-16 RTO during May 2025. | live | 1 | 10833 | OK |
| 23 | Query 32 | Vehicle registrations at MH-12 in January 2025. | live | 1 | 29588 | OK |
| 24 | Query 34 | Vehicle registrations in Delhi in 2025-01. | live | 1 | 75036 | OK |
| 26 | Query 44 | Show vehicals registrations in Maharashtra in January 2025. | live | 1 | 289682 | OK |
| 27 | Query 45 | Show motar car registrations in Maharashtra in January 2025. | live | 1 | 53382 | OK |
| 28 | Query 46 | Show light motor vehicl registrations in Maharashtra in January 2025. | live | 1 | 65810 | OK |
| 29 | Query 47 | Show BS-6 vehicle registrations in Delhi in January 2025. | live | 1 | 66459 | OK |
| 33 | Query 54 | Show CNG bus registrations in Uttar Pradesh from March 2024 to April 2025. | live | 14 | 1871 | OK |
| 34 | Query 55 | Show BS VI registrations at MH-12 RTO from December 2025 to January 2026. | live | 2 | 51718 | OK |
| 35 | Query 56 | Show non-EV registrations in Maharashtra in January 2025. | live | 1 | 289682 | OK |
| 37 | Query 58 | Show vehicle registrations excluding petrol in Maharashtra in March 2025. | live | 1 | 266954 | OK |
| 39 | Query 60 | Show EV registrations excluding PURE EV in Maharashtra in May 2025. | live | 1 | 2456 | OK |
| 40 | Query 61 | Show registrations excluding hybrid fuels in Maharashtra in June 2025. | live | 1 | 218544 | OK |
| 43 | Query 66 | Show vehicle registrations during February 2025. | live | 1 | 1996508 | OK |
| 44 | Query 68 | Show BS VI bus registrations in April 2025. | live | 1 | 7086 | OK |


## Parser Mismatch

_None_


## Data Missing Or Mismatch

| # | Label | Query | Status | Rows | Total | Issues |
| - | - | - | - | -: | -: | - |
| 17 | Query 24 | Show diesel registrations at DL-01 RTO during February 2025. | missing | 0 | 0 | The exact requested dashboard slice has no verified numeric rows; zero is not a source-backed result. |
| 18 | Query 25 | Show EV registrations at KA-01 RTO during March 2025. | missing | 0 | 0 | The exact requested dashboard slice has no verified numeric rows; zero is not a source-backed result. |
| 19 | Query 26 | Show two wheeler registrations at TN-01 RTO during April 2025. | missing | 0 | 0 | The exact requested dashboard slice has no verified numeric rows; zero is not a source-backed result. |
| 36 | Query 57 | Show vehicle registrations excluding BS IV vehicles in Maharashtra in February 2025. | missing | 0 | 0 | The exact requested dashboard slice has no verified numeric rows; zero is not a source-backed result. |
| 38 | Query 59 | Show vehicle registrations excluding buses in Maharashtra in April 2025. | missing | 0 | 0 | The exact requested dashboard slice has no verified numeric rows; zero is not a source-backed result. |
| 41 | Query 62 | Show vehicle registrations excluding two-wheeler transport in Maharashtra in July 2025. | missing | 0 | 0 | The exact requested dashboard slice has no verified numeric rows; zero is not a source-backed result. |
| 42 | Query 63 | Show BS VI registrations excluding BS IV vehicles in Maharashtra in August 2025. | missing | 0 | 0 | The exact requested dashboard slice has no verified numeric rows; zero is not a source-backed result. |


## Scrape Failed

| # | Label | Query | Status | Rows | Total | Issues |
| - | - | - | - | -: | -: | - |
| 14 | Query 20 | Show BS IV vehicle registrations in Goa during September 2025. | fetch_failed | 0 | 0 | Command failed: C:\Program Files\nodejs\node.exe scripts/vahan-scraper.mjs --mode scrape --no-persist --emit-rows-json --states Goa --years 2025 --months 9 --norms BHARAT STAGE IV [scraper] direct attempt 1/3 failed for 2025 Goa All RTOs: Public dashboard returned no monthly values for ALL. [scraper] direct attempt 2/3 failed for 2025 Goa All RTOs: Public dashboard returned no monthly values for ALL. [scraper] direct attempt 3/3 failed for 2025 Goa All RTOs: Public dashboard returned no monthly values for ALL. Failed: 2025 Goa All RTOs: Public dashboard returned no monthly values for ALL. Error: 1 scrape item(s) failed. See data\vahan\vahan_fuel_monthly_errors.jsonl     at scrape (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:1937:13)     at async main (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:2080:9) |
| 21 | Query 28 | Show BS IV CNG three wheeler registrations in Gujarat during June 2025. | fetch_failed | 0 | 0 | Command failed: C:\Program Files\nodejs\node.exe scripts/vahan-scraper.mjs --mode scrape --no-persist --emit-rows-json --states Gujarat --years 2025 --months 6 --fuels CNG ONLY --vehicle-categories THREE WHEELER(NT),THREE WHEELER(T) --norms BHARAT STAGE IV [scraper] direct attempt 1/3 failed for 2025 Gujarat All RTOs: Public dashboard returned no monthly values for CNG ONLY. [scraper] direct attempt 2/3 failed for 2025 Gujarat All RTOs: Public dashboard returned no monthly values for CNG ONLY. [scraper] direct attempt 3/3 failed for 2025 Gujarat All RTOs: Public dashboard returned no monthly values for CNG ONLY. Failed: 2025 Gujarat All RTOs: Public dashboard returned no monthly values for CNG ONLY. Error: 1 scrape item(s) failed. See data\vahan\vahan_fuel_monthly_errors.jsonl     at scrape (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:1937:13)     at async main (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:2080:9) |
| 22 | Query 30 | Show PHEV motor car registrations in Karnataka during August 2025. | fetch_failed | 0 | 0 | Command failed: C:\Program Files\nodejs\node.exe scripts/vahan-scraper.mjs --mode scrape --no-persist --emit-rows-json --states Karnataka --years 2025 --months 8 --fuels PLUG-IN HYBRID EV --vehicle-classes MOTOR CAR Failed: 2025 Karnataka All RTOs: Could not find month 8 for fuel "PLUG-IN HYBRID EV" Error: 1 scrape item(s) failed. See data\vahan\vahan_fuel_monthly_errors.jsonl     at scrape (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:1937:13)     at async main (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:2080:9) |
| 25 | Query 39 | How many BS4 LMV registrations used LPG in Rajasthan in Jul 2024? | fetch_failed | 0 | 0 | Command failed: C:\Program Files\nodejs\node.exe scripts/vahan-scraper.mjs --mode scrape --no-persist --emit-rows-json --states Rajasthan --years 2024 --months 7 --fuels LPG ONLY,PETROL(E20)/LPG,PETROL/LPG --vehicle-categories LIGHT MOTOR VEHICLE --norms BHARAT STAGE IV [scraper] direct attempt 1/3 failed for 2024 Rajasthan All RTOs: Public dashboard returned no monthly values for LPG ONLY. [scraper] direct attempt 2/3 failed for 2024 Rajasthan All RTOs: Public dashboard returned no monthly values for LPG ONLY. [scraper] direct attempt 3/3 failed for 2024 Rajasthan All RTOs: Public dashboard returned no monthly values for LPG ONLY. Failed: 2024 Rajasthan All RTOs: Public dashboard returned no monthly values for LPG ONLY. Error: 1 scrape item(s) failed. See data\vahan\vahan_fuel_monthly_errors.jsonl     at scrape (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:1937:13)     at async main (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:2080:9) |


## API Or Server Error

| # | Label | Query | Status | Rows | Total | Issues |
| - | - | - | - | -: | -: | - |
| 30 | Query 48 | Show battery-only road registrations around the garden city in January 2025. | api_server_error | 0 |  | I could not safely map that wording to one supported registration-total query. Please rephrase it with an exact state or RTO, month, and dashboard filter. Try: EV registrations in Maharashtra from January to March 2026. |
| 31 | Query 49 | Show clean-drive passenger registrations for the Pune office in the first month of 2025. | api_server_error | 0 |  | I could not safely map that wording to one supported registration-total query. Please rephrase it with an exact state or RTO, month, and dashboard filter. Try: EV registrations in Maharashtra from January to March 2026. |
| 32 | Query 50 | Give the plug car count for Karnataka at the close of Q1 2025. | api_server_error | 0 |  | I could not safely map that wording to one supported registration-total query. Please rephrase it with an exact state or RTO, month, and dashboard filter. Try: EV registrations in Maharashtra from January to March 2026. |

