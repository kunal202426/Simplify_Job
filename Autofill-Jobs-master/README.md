<div align="center">

https://github.com/user-attachments/assets/13f0fb66-7436-40ff-8faf-c2540084337b

<h1 align="center">
  Autofill Jobs
</h1>
  <p>
  A chrome extension that autofills job applications, built with 
  <a href="https://vuejs.org/">Vue</a>.
</p>
</div>

## Why I made this 

Job applications, especially on platforms like Workday, take way too long to fill out (up to 20 mins!)

I wanted to bring the ease-of-use of LinkedIn Easy Apply to other job platforms.


## How it works ✍️

 - Data is stored using chrome.storage.sync with the exception of larger files like résumés, which are stored with chrome.storage.local
 - Depending on platform (Greenhouse uses React components, Lever does not) the extension fills in the fields with the data
 - On Workday, ensure you have the tab open in full screen as some essential elements don't get rendered on smaller resolutions.

## Supported Platforms ✅
 - Greenhouse 
 - Lever 
 - Dover 
 - Workday 

## Getting Started 🚀
You can either build the extension locally:
```
# Clone the repository
git clone https://github.com/andrewmillercode/Autofill-Jobs.git

#Go to source directory
cd src

# Install required packages
npm i 

# Build extension
npm run build

# Then, navigate to chrome://extensions and load unpacked the dist folder.
```
Or download it from the Chrome Web Store [here](https://chromewebstore.google.com/detail/autofill-jobs/mfnfecldidgkknamdfibcdnmcjlaogpc)

## License 📝

This project is using the MIT License. If you'd like to report an issue with the extension, please use the issues tab. If you enjoy using this extension, please feel free to leave a ⭐. 

IMPORTANT: This project is not actively maintained at the moment.

