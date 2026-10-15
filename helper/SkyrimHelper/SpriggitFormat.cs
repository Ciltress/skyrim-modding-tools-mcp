// Spriggit's YAML format, reproduced: both classes below are copied from Spriggit (GPL-3.0,
// https://github.com/Mutagen-Modding/Spriggit) — Translation Packages/Spriggit.Yaml.Skyrim/Customization.cs
// and Spriggit.Core/WriteBuilderSpecialization.cs. The Customization makes Mutagen's serialization
// source generator emit `MutagenYamlConverter` into this assembly with Spriggit's layout.
using Mutagen.Bethesda.Plugins.Binary.Parameters;
using Mutagen.Bethesda.Plugins.Binary.Translations;
using Mutagen.Bethesda.Plugins.Records;
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

public static class WriteBuilderSpecialization
{
    /// <summary>Writes exactly what the text says — masters, counts, FormIDs — without correcting it.</summary>
    public static BinaryModdedWriteBuilder<TModGetter> AddNonOpinionatedWriteOptions<TModGetter>(this BinaryModdedWriteBuilder<TModGetter> builder)
        where TModGetter : class, IModGetter
    {
        return builder
            .WithRecordCount(RecordCountOption.Iterate)
            .WithModKeySync(ModKeyOption.CorrectToPath)
            .WithMastersListContent(MastersListContentOption.NoCheck)
            .WithMastersListOrdering(MastersListOrderingOption.NoCheck)
            .NoFormIDUniquenessCheck()
            .NoFormIDCompactnessCheck()
            .NoCheckIfLowerRangeDisallowed()
            .NoNullFormIDStandardization();
    }
}
