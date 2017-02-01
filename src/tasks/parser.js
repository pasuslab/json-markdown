'use strict';
const fs = require('fs');
const path = require('path');
// const http = require("http");
// const https = require("https");
const _ = require('lodash');
const type = require('../type');
const objectAssign = require('object-assign');

function Parser(file, tokens) {
  this.tokens = tokens;
  this.path = path.dirname(path.resolve(file));
  this.fileName = path.basename(file, '.json');
  this.json = JSON.parse(fs.readFileSync(file, 'utf8'));
}

objectAssign(Parser.prototype, {
  _requestUrlContent(url) {
    let result = '';
    return result;
  },
  _loadReferencesForItem(item) {
    let ref;
    let json;
    let promise;
    if (item.$ref) {
      if (item.$ref.startsWith('http://') || item.$ref.startsWith('https://')) {
        json = this._requestUrlContent(item.$ref);
      } else {
        ref = path.resolve(this.path, `${item.$ref.replace('#/', '')}.json`);
        json = JSON.parse(fs.readFileSync(ref, 'utf8'));
      }
      if (json.items) {
        json.items = this._loadReferencesForItem(json.items);
      }
      return json;
    }

    if (item.items) {
      item.items = this._loadReferencesForItem(item.items);
    }

    return item;
  },

  _parseRequired(tokenName, required, oneOf, anyOf) {
    const self = this;
    if (required) {
      self.tokens.addToToken(tokenName, 'required', required);
      required.map((key) => {
        self.tokens.addToToken(tokenName, `props:${key}`, {
          required: true
        });
      });
    }
    if (oneOf) {
      _.forIn(oneOf, (value) => {
        if (value.required) {
          self.tokens.addToToken(tokenName, 'requiredOneOf', value.required);
        }
      });
    }
    if (anyOf) {
      _.forIn(anyOf, (value) => {
        if (value.required) {
          self.tokens.addToToken(tokenName, 'requiredAnyOf', value.required);
        }
      });
    }
  },

  _type(value) {
    const self = this;
    let type = Array.isArray(value.type)?value.type.join(', '):value.type;
    if (type === 'array') {
      type += `[${value.items.type}]`;
    }
    return type;
  },

  _exampleStringFormat(value) {
    const self = this;
    if (!value.format) {
      return `"example"`;
    }
    let example = `"example"`;
    switch (value.format) {
      case 'date-time':
        example = `"1970-01-01T12:00:00Z"`;
      break;
      case 'date':
        example = `"1970-01-01"`;
      break;
      case 'email':
        example = `"firstname.lastname@example.com"`;
      break;
      case 'hostname':
        example = `"www.example.com"`;
      break;
      case 'ipv4':
        example = `"127.0.0.1"`;
      break;
      case 'ipv6':
        example = `"2001:db8:a0b:12f0::1"`;
      break;
      case 'uri':
        example = `"http://www.example.com/example"`;
      break;
      default:
    }
    return example;
  },

  _example(value) {
    const self = this;
    if (value.example) {
      return value.example;
    }
    let example = [];
    let values = Array.isArray(value.type)?value.type:[value.type];
    if (values.indexOf('string') >= 0) {
      example.push(value.enum && value.enum.length?`"${value.enum[0]}"`:self._exampleStringFormat(value)); //`"example"`;
    }
    if (values.indexOf('number') >= 0) {
      example.push(value.enum && value.enum.length?`${value.enum[0]}`:`42.0`);
    }
    if (values.indexOf('integer') >= 0) {
      example.push(value.enum && value.enum.length?`${value.enum[0]}`:`42`);
    }
    if (values.indexOf('boolean') >= 0) {
      example.push(`true`);
    }
    if (values.indexOf('object') >= 0) {
      example.push(`{...}`);
    }
    if (values.indexOf('array') >= 0) {
      example.push(`[${self._example(value.items)}, ${self._example(value.items)}]`);
    }
    // switch(value.type) {
    //   case 'string':
    //     example.push(value.enum && value.enum.length?`"${value.enum[0]}"`:self._exampleStringFormat(value)); //`"example"`;
    //   break;
    //   case 'number':
    //     example.push(value.enum && value.enum.length?`${value.enum[0]}`:`42.0`);
    //   break;
    //   case 'integer':
    //     example.push(value.enum && value.enum.length?`${value.enum[0]}`:`42`);
    //   break;
    //   case 'object':
    //     example.push(`{...}`);
    //   break;
    //   case 'array':
    //     example.push(`[${self._example(value.items)}, ${self._example(value.items)}]`);
    //   break;
    //   default:
    // }
    return example.join('<br/>');
  },

  _description(value) {
    const self = this;
    let description = value.description || ``;
    if (value.format) {
      description += `<br/>**format:** \`${value.format}\``;
    }
    if (value.pattern) {
      description += `<br/>**pattern:** \`/${value.pattern}/\``;
    }
    if (value.enum && value.enum.length) {
      description += `<br/>**one of:** \`"${value.enum.join('"\`, \`"')}"\``;
    }
    return description;
  },

  _parseProperties(tokenName, properties) {
    const subProps = {};
    const self = this;

    _.forIn(properties, (value, key) => {
      value = self._loadReferencesForItem(value);
      if (value.type === 'object') {
        subProps[key] = value;
      }
      if (value.items && value.items.type === 'object') {
        //subProps[`${key}: ${value.items.title}`] = value.items;
        subProps[key] = value.items;
      }
      self.tokens.addToToken(tokenName, `props:${key}`, {
        name: key,
        type: self._type(value), //value.type,
        description: self._description(value), //value.description,
        allowed: type(value),
        example: `\`${self._example(value)}\``
      });
    });
    this._parseSubProps(subProps);
  },

  _parseSubProps(subProps) {
    const self = this;

    _.forIn(subProps, (json, key) => {
      const tokenName = key;
      self.tokens.addToToken(tokenName, 'title', json.title);
      self.tokens.addToToken(tokenName, 'description', json.description);
      self.tokens.addToToken(tokenName, 'type', json.type);
      self.tokens.addToToken(tokenName, 'allowed', type(json));

      if (json.properties) {
        self._parseProperties(tokenName, json.properties);
        self._parseRequired(tokenName, json.required, json.oneOf, json.anyOf);
      }
    });
  },

  _parse(json) {
    const tokenName = json.id || this.fileName.replace('_', ' ').replace('.', ' '); //'default';
    this.tokens.addToToken(tokenName, 'title', json.title);
    this.tokens.addToToken(tokenName, 'description', json.description);
    if (typeof json.type === 'string') {
      this.tokens.addToToken(tokenName, 'type', json.type);
    }
    if (json.properties) {
      this._parseProperties(tokenName, json.properties);
      this._parseRequired(tokenName, json.required, json.oneOf, json.anyOf);
    }
  },

  parse(callback) {
    try {
      this._parse(this.json);
      callback();
    } catch (e) {
      callback(e);
    }
  }
});

module.exports = (file, tokens) => {
  return new Parser(file, tokens);
};
