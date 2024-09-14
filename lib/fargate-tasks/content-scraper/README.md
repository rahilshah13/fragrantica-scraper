1) `npm run dev` to run locally 
2) docker build -t content-scraper --build-arg NODE_ENV=dev .
  - do not specify build-arg for prod build
3) docker run --rm -it -e NODE_ENV=dev content-scraper 
