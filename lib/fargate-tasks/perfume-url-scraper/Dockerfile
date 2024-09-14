FROM ubuntu:focal
ENV NODE_ENV=prod
RUN apt-get update; apt-get clean

# Add a user for running applications.
#RUN useradd apps
#RUN mkdir -p /home/apps && chown apps:apps /home/apps

# Install xvfb and other stuff.
RUN apt-get install -y xvfb fluxbox wget wmctrl gnupg2

# Set the Chrome repo.
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list

# Install Chrome.
RUN apt-get update && apt-get -y install google-chrome-stable

# Install utils for ric
RUN apt install -y curl wget git g++ make cmake unzip libcurl4-openssl-dev autoconf libtool

# install NodeJS
RUN curl -sL https://deb.nodesource.com/setup_18.x | bash -
RUN apt install -y nodejs


# App setup
WORKDIR /usr/src/app
COPY package.json .

# Install ric
# RUN npm i aws-lambda-ric

# Install deps
RUN npm i

# Add Lambda Runtime Interface Emulator and use a script in the ENTRYPOINT for simpler local runs
# ADD https://github.com/aws/aws-lambda-runtime-interface-emulator/releases/latest/download/aws-lambda-rie /usr/local/bin/aws-lambda-rie
# RUN chmod 755 /usr/local/bin/aws-lambda-rie
# COPY bootstrap.sh /
# RUN chmod 755 /bootstrap.sh

# Build app (last for cache speed)
COPY app.js .

#ENTRYPOINT [ "/bootstrap.sh" ]
#CMD ["app.handler"]
CMD ["npm", "run", "start"]