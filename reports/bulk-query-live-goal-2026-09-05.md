# Bulk Query Test Report

Generated: 2026-09-05T16:17:32.148Z
Mode: live
Input: data\query-tests\bulk-queries.csv
JSON report: reports/bulk-query-live-goal-2026-09-05.json

## Summary

Completed: 110
Passed: 0
Failed: 110
Refreshed: 10
Refresh failed: 10

## Pass

_None_


## Parser Mismatch

_None_


## Data Missing Or Mismatch

_None_


## Scrape Failed

| # | Label | Query | Status | Rows | Total | Issues |
| - | - | - | - | -: | -: | - |
| 1 | Maharashtra EV Jan 2024 | EV registrations in Maharashtra in Jan 2024 | fetch_failed | 0 | 0 | minRows: expected at least 1, got 0; Command failed: C:\Program Files\nodejs\node.exe scripts/vahan-scraper.mjs --mode scrape --no-persist --emit-rows-json --states Maharashtra --years 2024 --months 1 --fuels ELECTRIC(BOV),PURE EV [scraper] direct attempt 1/3 failed for 2024 Maharashtra All RTOs: fetch failed [scraper] direct attempt 2/3 failed for 2024 Maharashtra All RTOs: fetch failed [scraper] direct attempt 3/3 failed for 2024 Maharashtra All RTOs: fetch failed Failed: 2024 Maharashtra All RTOs: fetch failed Error: 1 scrape item(s) failed. See data\vahan\vahan_fuel_monthly_errors.jsonl     at scrape (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:1921:13)     at async main (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:2064:9) |
| 2 | Noida petrol Jan 2026 | Noida petrol registrations in January 2026 | fetch_failed | 0 | 0 | Command failed: C:\Program Files\nodejs\node.exe scripts/vahan-scraper.mjs --mode scrape --no-persist --emit-rows-json --states Uttar Pradesh --years 2026 --months 1 --rtos Noida - UP16( 13-NOV-2017 ) --fuels PETROL [scraper] direct attempt 1/3 failed for 2026 Uttar Pradesh Noida - UP16( 13-NOV-2017 ): fetch failed [scraper] direct attempt 2/3 failed for 2026 Uttar Pradesh Noida - UP16( 13-NOV-2017 ): fetch failed [scraper] direct attempt 3/3 failed for 2026 Uttar Pradesh Noida - UP16( 13-NOV-2017 ): fetch failed Failed: 2026 Uttar Pradesh Noida - UP16( 13-NOV-2017 ): fetch failed Error: 1 scrape item(s) failed. See data\vahan\vahan_fuel_monthly_errors.jsonl     at scrape (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:1921:13)     at async main (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:2064:9) |
| 3 | Haridwar electric cars Jan 2024 | electric cars in Haridwar Jan 2024 | fetch_failed | 0 | 0 | Command failed: C:\Program Files\nodejs\node.exe scripts/vahan-scraper.mjs --mode scrape --no-persist --emit-rows-json --states Uttarakhand --years 2024 --months 1 --rtos haridwar --fuels ELECTRIC(BOV),PURE EV --vehicle-classes MOTOR CAR [scraper] direct attempt 1/3 failed for 2024 Uttarakhand haridwar: fetch failed [scraper] direct attempt 2/3 failed for 2024 Uttarakhand haridwar: fetch failed [scraper] direct attempt 3/3 failed for 2024 Uttarakhand haridwar: fetch failed Failed: 2024 Uttarakhand haridwar: fetch failed Error: 1 scrape item(s) failed. See data\vahan\vahan_fuel_monthly_errors.jsonl     at scrape (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:1921:13)     at async main (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:2064:9) |
| 4 | Typo petrol motor car | petorl motar car registrations in Maharashtra in Jan 2024 | fetch_failed | 0 | 0 | Command failed: C:\Program Files\nodejs\node.exe scripts/vahan-scraper.mjs --mode scrape --no-persist --emit-rows-json --states Maharashtra --years 2024 --months 1 --fuels PETROL --vehicle-classes MOTOR CAR [scraper] direct attempt 1/3 failed for 2024 Maharashtra All RTOs: fetch failed [scraper] direct attempt 2/3 failed for 2024 Maharashtra All RTOs: fetch failed [scraper] direct attempt 3/3 failed for 2024 Maharashtra All RTOs: fetch failed Failed: 2024 Maharashtra All RTOs: fetch failed Error: 1 scrape item(s) failed. See data\vahan\vahan_fuel_monthly_errors.jsonl     at scrape (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:1921:13)     at async main (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:2064:9) |
| 5 | Delhi hybrid Jan 2025 | hybrid registrations in Delhi Jan 2025 | fetch_failed | 0 | 0 | Command failed: C:\Program Files\nodejs\node.exe scripts/vahan-scraper.mjs --mode scrape --no-persist --emit-rows-json --states Delhi --years 2025 --months 1 --fuels DIESEL/HYBRID,PETROL(E20)/HYBRID,PETROL(E20)/HYBRID/CNG,PETROL/HYBRID,PETROL/HYBRID/CNG,PLUG-IN HYBRID EV,STRONG HYBRID EV [scraper] direct attempt 1/3 failed for 2025 Delhi All RTOs: fetch failed [scraper] direct attempt 2/3 failed for 2025 Delhi All RTOs: fetch failed [scraper] direct attempt 3/3 failed for 2025 Delhi All RTOs: fetch failed Failed: 2025 Delhi All RTOs: fetch failed Error: 1 scrape item(s) failed. See data\vahan\vahan_fuel_monthly_errors.jsonl     at scrape (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:1921:13)     at async main (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:2064:9) |
| 6 | Delhi two wheelers Jan 2026 | electric two wheelers in Delhi Jan 2026 | fetch_failed | 0 | 0 | Command failed: C:\Program Files\nodejs\node.exe scripts/vahan-scraper.mjs --mode scrape --no-persist --emit-rows-json --states Delhi --years 2026 --months 1 --fuels ELECTRIC(BOV),PURE EV --vehicle-categories TWO WHEELER(NT),TWO WHEELER(T) [scraper] direct attempt 1/3 failed for 2026 Delhi All RTOs: fetch failed [scraper] direct attempt 2/3 failed for 2026 Delhi All RTOs: fetch failed [scraper] direct attempt 3/3 failed for 2026 Delhi All RTOs: fetch failed Failed: 2026 Delhi All RTOs: fetch failed Error: 1 scrape item(s) failed. See data\vahan\vahan_fuel_monthly_errors.jsonl     at scrape (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:1921:13)     at async main (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:2064:9) |
| 7 | Delhi e-rickshaw Jan 2025 | e-rickshaw in Delhi Jan 2025 | fetch_failed | 0 | 0 | Command failed: C:\Program Files\nodejs\node.exe scripts/vahan-scraper.mjs --mode scrape --no-persist --emit-rows-json --states Delhi --years 2025 --months 1 --vehicle-classes E-RICKSHAW WITH CART (G),E-RICKSHAW(P) [scraper] direct attempt 1/3 failed for 2025 Delhi All RTOs: fetch failed [scraper] direct attempt 2/3 failed for 2025 Delhi All RTOs: fetch failed [scraper] direct attempt 3/3 failed for 2025 Delhi All RTOs: fetch failed Failed: 2025 Delhi All RTOs: fetch failed Error: 1 scrape item(s) failed. See data\vahan\vahan_fuel_monthly_errors.jsonl     at scrape (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:1921:13)     at async main (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:2064:9) |
| 8 | Maharashtra fork lift Jan 2024 | diesel fork lift registrations in Maharashtra from Jan 2024 to Jan 2024 | fetch_failed | 0 | 0 | minRows: expected at least 1, got 0; Command failed: C:\Program Files\nodejs\node.exe scripts/vahan-scraper.mjs --mode scrape --no-persist --emit-rows-json --states Maharashtra --years 2024 --months 1 --fuels DIESEL --vehicle-classes FORK LIFT [scraper] direct attempt 1/3 failed for 2024 Maharashtra All RTOs: fetch failed [scraper] direct attempt 2/3 failed for 2024 Maharashtra All RTOs: fetch failed [scraper] direct attempt 3/3 failed for 2024 Maharashtra All RTOs: fetch failed Failed: 2024 Maharashtra All RTOs: fetch failed Error: 1 scrape item(s) failed. See data\vahan\vahan_fuel_monthly_errors.jsonl     at scrape (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:1921:13)     at async main (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:2064:9) |
| 9 | Gujarat diesel Apr 2026 | Gujarat diesel registrations in April 2026 | fetch_failed | 0 | 0 | Command failed: C:\Program Files\nodejs\node.exe scripts/vahan-scraper.mjs --mode scrape --no-persist --emit-rows-json --states Gujarat --years 2026 --months 4 --fuels DIESEL [scraper] direct attempt 1/3 failed for 2026 Gujarat All RTOs: fetch failed [scraper] direct attempt 2/3 failed for 2026 Gujarat All RTOs: fetch failed [scraper] direct attempt 3/3 failed for 2026 Gujarat All RTOs: fetch failed Failed: 2026 Gujarat All RTOs: fetch failed Error: 1 scrape item(s) failed. See data\vahan\vahan_fuel_monthly_errors.jsonl     at scrape (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:1921:13)     at async main (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:2064:9) |
| 10 | Punjab registrations Apr 2026 | Punjab registrations in April 2026 | fetch_failed | 0 | 0 | Command failed: C:\Program Files\nodejs\node.exe scripts/vahan-scraper.mjs --mode scrape --no-persist --emit-rows-json --states Punjab --years 2026 --months 4 [scraper] direct attempt 1/3 failed for 2026 Punjab All RTOs: fetch failed [scraper] direct attempt 2/3 failed for 2026 Punjab All RTOs: fetch failed [scraper] direct attempt 3/3 failed for 2026 Punjab All RTOs: fetch failed Failed: 2026 Punjab All RTOs: fetch failed Error: 1 scrape item(s) failed. See data\vahan\vahan_fuel_monthly_errors.jsonl     at scrape (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:1921:13)     at async main (file:///C:/Users/amogh/Desktop/BHAIYA/Vahan%20EY/scripts/vahan-scraper.mjs:2064:9) |


## API Or Server Error

| # | Label | Query | Status | Rows | Total | Issues |
| - | - | - | - | -: | -: | - |
| 11 | Bulk 1 | How many BS VI petrol two-wheelers were registered in Delhi in January 2026? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 12 | Bulk 2 | Show the registration count of BS VI diesel passenger cars in Maharashtra in February 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 13 | Bulk 3 | How many BS IV CNG auto-rickshaws were registered in Gujarat during March 2025? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 14 | Bulk 4 | Give the number of BS VI hybrid passenger vehicles registered in Karnataka in April 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 15 | Bulk 5 | Show total registrations of BS VI petrol scooters in Tamil Nadu in May 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 16 | Bulk 6 | How many BS VI diesel goods carriers were registered in Uttar Pradesh in June 2026? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 17 | Bulk 7 | Find the registration count of BS IV LPG three-wheelers in Rajasthan in July 2024. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 18 | Bulk 8 | How many BS VI CNG buses were registered in Haryana in August 2025? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 19 | Bulk 9 | Show the count of BS VI petrol motorcycles registered in Punjab in September 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 20 | Bulk 10 | How many BS VI diesel tractors were registered in Madhya Pradesh in October 2024? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 21 | Bulk 11 | Give registrations of BS VI petrol private cars in Telangana in November 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 22 | Bulk 12 | Show the number of BS VI CNG taxis registered in West Bengal in December 2024. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 23 | Bulk 13 | How many Euro 6 diesel passenger cars were registered in Kerala in January 2025? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 24 | Bulk 14 | Find the count of Euro 5 petrol motorcycles registered in Goa in February 2024. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 25 | Bulk 15 | Show registrations of Euro 6 hybrid cars in Chandigarh in March 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 26 | Bulk 16 | How many CEV Stage IV diesel construction vehicles were registered in Odisha in April 2025? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 27 | Bulk 17 | Give the registration count of CEV Stage V excavators in Chhattisgarh in May 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 28 | Bulk 18 | How many CEV Stage III diesel cranes were registered in Jharkhand in June 2024? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 29 | Bulk 19 | Show total BS VI petrol mopeds registered in Assam in July 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 30 | Bulk 20 | How many BS VI diesel school buses were registered in Bihar in August 2024? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 31 | Bulk 21 | Find the number of BS VI CNG light commercial vehicles registered in Uttarakhand in September 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 32 | Bulk 22 | Show registrations of BS VI petrol ambulances in Himachal Pradesh in October 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 33 | Bulk 23 | How many BS VI diesel fire tenders were registered in Jammu and Kashmir in November 2024? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 34 | Bulk 24 | Give the count of BS IV petrol quadricycles registered in Puducherry in December 2023. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 35 | Bulk 25 | How many BS VI flex-fuel cars were registered in Maharashtra in January 2026? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 36 | Bulk 26 | Show the registration count of BS VI petrol cars at RTO MH12 in January 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 37 | Bulk 27 | How many BS VI diesel motorcycles were registered at RTO DL01 in February 2025? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 38 | Bulk 28 | Give the number of BS VI CNG auto-rickshaws registered at RTO GJ01 in March 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 39 | Bulk 29 | Show registrations of BS VI hybrid cars at RTO KA03 in April 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 40 | Bulk 30 | How many BS IV petrol scooters were registered at RTO TN01 in May 2024? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 41 | Bulk 31 | Find the count of BS VI diesel goods carriers at RTO UP16 in June 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 42 | Bulk 32 | How many BS VI CNG buses were registered at RTO HR26 in July 2025? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 43 | Bulk 33 | Show total BS VI petrol taxis registered at RTO WB02 in August 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 44 | Bulk 34 | Give registrations of Euro 6 diesel cars at RTO KL07 in September 2024. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 45 | Bulk 35 | How many Euro 5 petrol motorcycles were registered at RTO GA01 in October 2023? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 46 | Bulk 36 | Show the count of CEV Stage V excavators registered at RTO CG04 in November 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 47 | Bulk 37 | How many CEV Stage IV cranes were registered at RTO OD02 in December 2024? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 48 | Bulk 38 | Find registrations of BS VI diesel tractors at RTO MP09 in January 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 49 | Bulk 39 | How many BS VI petrol private cars were registered at RTO TS09 in February 2026? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 50 | Bulk 40 | Show the number of BS VI CNG three-wheelers registered at RTO AS01 in March 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 51 | Bulk 41 | Give the count of BS IV diesel buses registered at RTO BR01 in April 2024. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 52 | Bulk 42 | How many BS VI petrol motorcycles were registered at RTO PB10 in May 2026? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 53 | Bulk 43 | Show registrations of BS VI diesel light commercial vehicles at RTO UK07 in June 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 54 | Bulk 44 | How many BS VI hybrid taxis were registered at RTO DL03 in July 2026? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 55 | Bulk 45 | Find the count of BS VI petrol scooters at RTO MH01 in August 2024. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 56 | Bulk 46 | Show total BS VI CNG cars registered at RTO GJ05 in September 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 57 | Bulk 47 | How many BS VI diesel heavy commercial vehicles were registered at RTO RJ14 in October 2025? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 58 | Bulk 48 | Give registrations of Euro 6 petrol cars at RTO KA01 in November 2024. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 59 | Bulk 49 | How many CEV Stage III loaders were registered at RTO JH01 in December 2023? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 60 | Bulk 50 | Show the count of BS VI diesel school buses at RTO TN07 in January 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 61 | Bulk 51 | How many BS VI petrol two-wheelers were registered in Delhi from January to March 2026? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 62 | Bulk 52 | Show BS VI diesel passenger-car registrations in Maharashtra from April to June 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 63 | Bulk 53 | Give the count of BS VI CNG auto-rickshaws registered in Gujarat between July and September 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 64 | Bulk 54 | How many BS VI hybrid cars were registered in Karnataka from October 2024 to March 2025? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 65 | Bulk 55 | Show total BS IV petrol scooter registrations in Tamil Nadu during financial year 2023-24. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 66 | Bulk 56 | How many BS VI diesel goods vehicles were registered in Uttar Pradesh during calendar year 2025? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 67 | Bulk 57 | Find Euro 6 petrol car registrations in Kerala from January 2024 to December 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 68 | Bulk 58 | Show the count of CEV Stage IV construction equipment registered in Odisha between April 2024 and March 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 69 | Bulk 59 | How many CEV Stage V excavators were registered in Chhattisgarh from January to June 2026? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 70 | Bulk 60 | Give BS VI CNG bus registration counts in Haryana from July 2025 to June 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 71 | Bulk 61 | Show BS VI petrol motorcycle registrations in Punjab between January 2023 and December 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 72 | Bulk 62 | How many BS VI diesel tractors were registered in Madhya Pradesh during the monsoon months of 2025? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 73 | Bulk 63 | Find BS VI hybrid taxi registrations in Telangana from April to September 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 74 | Bulk 64 | Show the count of BS VI CNG taxis registered in West Bengal during Q4 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 75 | Bulk 65 | How many Euro 5 diesel cars were registered in Goa during the first half of 2024? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 76 | Bulk 66 | Give Euro 6 hybrid passenger-vehicle registrations in Chandigarh from January to December 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 77 | Bulk 67 | Show BS IV LPG three-wheeler registrations in Rajasthan between 2022 and 2024. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 78 | Bulk 68 | How many BS VI petrol ambulances were registered in Uttarakhand from January 2025 to June 2026? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 79 | Bulk 69 | Find BS VI diesel school-bus registrations in Bihar during academic year 2024-25. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 80 | Bulk 70 | Show CEV Stage III crane registrations in Jharkhand from April 2023 to March 2024. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 81 | Bulk 71 | Compare the registration counts of BS VI petrol and diesel cars in Delhi during 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 82 | Bulk 72 | Compare BS VI CNG and petrol auto-rickshaw registrations in Maharashtra from January to June 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 83 | Bulk 73 | Show the monthly registration count of BS VI hybrid cars in Karnataka for 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 84 | Bulk 74 | Compare BS IV and BS VI diesel bus registrations in Uttar Pradesh during 2024. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 85 | Bulk 75 | Show state-wise registration counts of Euro 6 petrol cars from January to March 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 86 | Bulk 76 | Compare CEV Stage IV and CEV Stage V excavator registrations in Odisha during 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 87 | Bulk 77 | Show RTO-wise BS VI petrol two-wheeler registration counts in Gujarat for April 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 88 | Bulk 78 | Compare BS VI diesel goods-carrier registrations at MH12 and MH01 from July to December 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 89 | Bulk 79 | Show the top five RTOs by BS VI CNG taxi registrations in Delhi during 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 90 | Bulk 80 | Compare BS VI petrol scooter registrations in TN01 and TN07 during Q1 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 91 | Bulk 81 | Show month-wise BS VI diesel tractor registration counts in Madhya Pradesh for 2024. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 92 | Bulk 82 | Compare Euro 5 and Euro 6 petrol car registrations in Kerala from 2023 to 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 93 | Bulk 83 | Show district-level registration counts of BS VI hybrid passenger cars in Telangana during 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 94 | Bulk 84 | Compare BS VI CNG bus registrations in Haryana and Punjab from April 2025 to March 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 95 | Bulk 85 | Show annual registration counts of CEV Stage V construction vehicles in Chhattisgarh from 2022 to 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 96 | Bulk 86 | Compare BS VI petrol motorcycle registrations in Assam and West Bengal during 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 97 | Bulk 87 | Show the registration count of BS VI diesel ambulances across all RTOs in Rajasthan in 2024. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 98 | Bulk 88 | Compare BS IV LPG and BS VI CNG three-wheeler registrations in Gujarat during 2023. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 99 | Bulk 89 | Show quarterly BS VI hybrid taxi registrations at RTO DL03 for 2025 and 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 100 | Bulk 90 | Compare BS VI petrol private-car registrations at KA01 and KA03 in calendar year 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 101 | Bulk 91 | How many electric two-wheelers were registered in Delhi in January 2026, with the emission norm marked as not applicable? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 102 | Bulk 92 | Show the count of electric three-wheelers registered at RTO UP16 from January to March 2026, excluding BS and Euro norms. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 103 | Bulk 93 | How many battery-operated passenger cars were registered in Maharashtra during 2025 under the non-emission category? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 104 | Bulk 94 | Give the registration count of electric buses in Karnataka from April 2025 to March 2026 where the emission norm is not applicable. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 105 | Bulk 95 | Show registrations of plug-in hybrid BS VI cars in Tamil Nadu during Q2 2026. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 106 | Bulk 96 | How many hydrogen fuel-cell buses were registered in Delhi during 2025 with the emission norm marked as not applicable? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 107 | Bulk 97 | Find the registration count of BS VI ethanol cars in Uttar Pradesh from January to December 2025. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 108 | Bulk 98 | Show BS VI LNG heavy commercial vehicle registrations in Gujarat during financial year 2025-26. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 109 | Bulk 99 | How many BS VI methanol buses were registered in Maharashtra between January and June 2026? | api_server_error | 0 |  | Too many requests. Please wait before trying again. |
| 110 | Bulk 100 | Compare registration counts of electric, petrol, diesel, CNG, and hybrid passenger cars in Delhi during 2025, grouped by applicable emission norm. | api_server_error | 0 |  | Too many requests. Please wait before trying again. |

