# nginx serves the page, install.sh and the zip. Nothing else runs.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html style.css install.sh pr-map-*.zip /usr/share/nginx/html/
EXPOSE 8080
