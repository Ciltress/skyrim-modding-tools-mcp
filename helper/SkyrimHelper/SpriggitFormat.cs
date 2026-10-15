// Spriggit's YAML format, reproduced: the class below is copied from Spriggit (GPL-3.0,
// https://github.com/Mutagen-Modding/Spriggit) — Translation Packages/Spriggit.Yaml.Skyrim/Customization.cs.
// It makes Mutagen's serialization source generator emit `MutagenYamlConverter` into this assembly with
// Spriggit's layout. Writing the binary plugin is not Spriggit's business here: the build lets Mutagen
// derive the masters from the load order (Session.Build), where Spriggit writes exactly what its text says.
using Mutagen.Bethesda.Serialization.Customizations;

namespace SkyrimHelper;

public class Customization : ICustomize
{
    public void Customize(ICustomizationBuilder builder)
    {
        builder
            .OmitLastModifiedData()
            .OmitTimestampData()
            .OmitUnknownGroupData()
            .OmitUnusedConditionDataFields()
            .FilePerRecord();
    }
}
