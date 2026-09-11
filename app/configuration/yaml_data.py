"""Bounded data-only YAML parsing shared by agent and skill configuration."""

import yaml
from yaml.tokens import AliasToken, AnchorToken


def load_yaml_data(source: str):
    if not isinstance(source, str) or not source or len(source.encode()) > 65536:
        raise ValueError(
            "configuration must be a non-empty YAML document no larger than 64 KiB"
        )
    tokens = list(yaml.scan(source))
    if any(isinstance(t, (AliasToken, AnchorToken)) for t in tokens):
        raise ValueError("YAML aliases and anchors are not allowed")

    class Loader(yaml.SafeLoader):
        pass

    def mapping(loader, node, deep=False):
        result = {}
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node, deep=deep)
            if not isinstance(key, str):
                raise ValueError("YAML mapping keys must be strings")
            if key in result:
                raise ValueError(f"duplicate YAML key: {key}")
            result[key] = loader.construct_object(value_node, deep=deep)
        return result

    Loader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping)
    return yaml.load(source, Loader=Loader)
